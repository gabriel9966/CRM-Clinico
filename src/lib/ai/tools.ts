import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { AppError } from "@/lib/errors";
import { toTzIso } from "@/lib/scheduling/time";
import { getAvailability, bookAppointment, rescheduleAppointment, cancelAppointment } from "@/lib/scheduling/service";
import type { AiToolName } from "./models";

// Ferramentas que o agente de IA pode chamar. Regras de segurança (valem para todas):
//  - o contato NUNCA vem do modelo: é sempre o contato da conversa (ctx.contactId),
//    então uma mensagem maliciosa não consegue pedir dados ou ações de outra pessoa;
//  - só as ferramentas liberadas no agente existem (ctx.enabled);
//  - ações que alteram dados têm limite por conversa (ctx.counts);
//  - agendar/remarcar/cancelar passam pelas mesmas regras da agenda (conflitos,
//    antecedência, grade) e só mexem em agendamentos DO PRÓPRIO contato;
//  - em modo de teste (dryRun) nada é gravado.

export type ToolCtx = {
  organizationId: string;
  contactId: string | null;
  conversationId: string | null;
  dryRun: boolean;
  /** Identifica esta execução (idempotência: repetir a chamada não duplica o agendamento). */
  runKey: string;
  enabled: Set<string>;
  counts: Record<string, number>;
  state: { handoffReason?: string };
};

export type ToolResult = { content: string; isError?: boolean };

export type ToolDef = {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
  strict: true;
};

const LIMITS: Partial<Record<string, number>> = {
  book_appointment: 2,
  reschedule_appointment: 2,
  cancel_appointment: 1,
  save_contact_info: 2,
  create_follow_up_task: 2,
};

const obj = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});

const TOOL_DEFS: Record<AiToolName | "handoff_to_human", ToolDef> = {
  get_contact: {
    name: "get_contact",
    description: "Dados básicos do cliente desta conversa: primeiro nome, etiquetas e se há telefone/e-mail cadastrados.",
    input_schema: obj({}),
    strict: true,
  },
  save_contact_info: {
    name: "save_contact_info",
    description: "Atualiza o nome e/ou o e-mail do cliente desta conversa, quando ele informar. Use só com dados que o cliente confirmou.",
    input_schema: obj({ name: { type: "string", description: "Nome completo" }, email: { type: "string", description: "E-mail" } }),
    strict: true,
  },
  list_procedures: {
    name: "list_procedures",
    description: "Lista os procedimentos/serviços ativos com id, duração em minutos e preço. Use para responder dúvidas de valor e duração e para obter o procedureId.",
    input_schema: obj({}),
    strict: true,
  },
  list_professionals: {
    name: "list_professionals",
    description: "Lista os profissionais que atendem, com id e especialidade.",
    input_schema: obj({}),
    strict: true,
  },
  get_availability: {
    name: "get_availability",
    description: "Horários livres na agenda. Informe procedureId (obtido em list_procedures). Datas no formato AAAA-MM-DD; sem datas, mostra os próximos 7 dias. Devolve no máximo 12 horários.",
    input_schema: obj({
      procedureId: { type: "string" },
      professionalId: { type: "string", description: "Opcional: restringe a um profissional" },
      from: { type: "string", description: "AAAA-MM-DD" },
      to: { type: "string", description: "AAAA-MM-DD" },
    }, ["procedureId"]),
    strict: true,
  },
  book_appointment: {
    name: "book_appointment",
    description: "Agenda um atendimento para ESTE cliente num horário livre. Use o campo start exatamente como veio em get_availability. Só chame depois que o cliente confirmar procedimento, data e hora.",
    input_schema: obj({
      start: { type: "string", description: "Início exato do horário livre (ISO 8601 com fuso), igual ao devolvido por get_availability" },
      procedureId: { type: "string" },
      professionalId: { type: "string", description: "Opcional" },
      notes: { type: "string", description: "Observação do cliente, se houver" },
    }, ["start", "procedureId"]),
    strict: true,
  },
  list_my_appointments: {
    name: "list_my_appointments",
    description: "Próximos agendamentos deste cliente (id, horário e situação).",
    input_schema: obj({}),
    strict: true,
  },
  reschedule_appointment: {
    name: "reschedule_appointment",
    description: "Muda o horário de um agendamento DESTE cliente para outro horário livre (start de get_availability). Confirme com o cliente antes.",
    input_schema: obj({ appointmentId: { type: "string" }, start: { type: "string" } }, ["appointmentId", "start"]),
    strict: true,
  },
  cancel_appointment: {
    name: "cancel_appointment",
    description: "Cancela um agendamento futuro DESTE cliente. Só depois que o cliente confirmar que quer cancelar.",
    input_schema: obj({ appointmentId: { type: "string" }, reason: { type: "string", description: "Motivo dito pelo cliente" } }, ["appointmentId"]),
    strict: true,
  },
  create_follow_up_task: {
    name: "create_follow_up_task",
    description: "Cria uma tarefa para a equipe acompanhar este cliente (ex.: retornar uma ligação, enviar um orçamento).",
    input_schema: obj({
      title: { type: "string" },
      notes: { type: "string" },
      dueInDays: { type: "integer", description: "Prazo em dias a partir de hoje (0 = hoje)" },
    }, ["title"]),
    strict: true,
  },
  handoff_to_human: {
    name: "handoff_to_human",
    description: "Passa a conversa para um atendente humano e pausa o agente nesta conversa. Use em dúvidas clínicas, urgências, reclamações, pedido de reembolso, quando o cliente pedir uma pessoa ou quando você não conseguir resolver. Depois de chamar, despeça-se com uma frase curta avisando que um atendente vai continuar.",
    input_schema: obj({ reason: { type: "string", description: "Resumo curto do motivo, para o atendente" } }, ["reason"]),
    strict: true,
  },
};

/** Definições enviadas ao modelo: só as liberadas + a de passar para humano (sempre). */
export function toolDefsFor(enabled: Iterable<string>): ToolDef[] {
  const on = new Set(enabled);
  const defs = (Object.keys(TOOL_DEFS) as (keyof typeof TOOL_DEFS)[])
    .filter((name) => name === "handoff_to_human" || on.has(name))
    .map((name) => TOOL_DEFS[name]);
  return defs;
}

const ok = (data: unknown): ToolResult => ({ content: JSON.stringify(data) });
const fail = (error: string, detail?: string): ToolResult => ({ content: JSON.stringify({ error, ...(detail ? { detail } : {}) }), isError: true });

const money = (cents: number) => `R$ ${(cents / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const idempotencyKey = (ctx: ToolCtx, ...parts: string[]) =>
  `ai:${createHash("sha256").update([ctx.runKey, ...parts].join("|")).digest("hex").slice(0, 40)}`;

async function ownedAppointment(ctx: ToolCtx, appointmentId: string) {
  if (!ctx.contactId) return null;
  return prisma.appointment.findFirst({
    where: { id: appointmentId, organizationId: ctx.organizationId, contactId: ctx.contactId },
  });
}

export async function executeTool(ctx: ToolCtx, name: string, rawInput: unknown): Promise<ToolResult> {
  if (name !== "handoff_to_human" && !ctx.enabled.has(name)) return fail("ferramenta_indisponivel", "Esta ferramenta não está liberada para este agente.");

  const limit = LIMITS[name];
  if (limit !== undefined) {
    const used = ctx.counts[name] ?? 0;
    if (used >= limit) return fail("limite_da_conversa", `Limite de ${limit} chamada(s) de ${name} por resposta atingido. Passe para um atendente se precisar de mais.`);
    ctx.counts[name] = used + 1;
  }

  try {
    return await run(ctx, name, rawInput);
  } catch (error) {
    if (error instanceof z.ZodError) return fail("entrada_invalida", error.issues.map((i) => `${i.path.join(".") || "entrada"}: ${i.message}`).join("; "));
    if (error instanceof AppError) return fail(error.code, error.message);
    console.error(`[ai] erro na ferramenta ${name}:`, error);
    return fail("erro_interno", "Não foi possível executar agora.");
  }
}

async function run(ctx: ToolCtx, name: string, rawInput: unknown): Promise<ToolResult> {
  const org = ctx.organizationId;
  switch (name) {
    case "get_contact": {
      if (!ctx.contactId) return ok({ firstName: "Paciente de teste", tags: [], hasPhone: true, hasEmail: false });
      const c = await prisma.contact.findFirst({ where: { id: ctx.contactId, organizationId: org }, select: { name: true, email: true, phone: true, tags: true } });
      if (!c) return fail("contato_nao_encontrado");
      let tags: string[] = [];
      try { const parsed = JSON.parse(c.tags); if (Array.isArray(parsed)) tags = parsed.filter((t) => typeof t === "string"); } catch { /* sem tags */ }
      return ok({ firstName: c.name.split(" ")[0] ?? c.name, tags, hasPhone: !!c.phone, hasEmail: !!c.email });
    }

    case "save_contact_info": {
      const input = z.object({ name: z.string().trim().min(2).max(120).optional(), email: z.string().trim().email().max(160).optional() }).parse(rawInput);
      if (!input.name && !input.email) return fail("nada_para_salvar");
      if (ctx.dryRun || !ctx.contactId) return ok({ simulated: true, saved: input });
      await prisma.contact.updateMany({ where: { id: ctx.contactId, organizationId: org }, data: { ...(input.name ? { name: input.name } : {}), ...(input.email ? { email: input.email.toLowerCase() } : {}) } });
      return ok({ saved: true });
    }

    case "list_procedures": {
      const rows = await prisma.procedure.findMany({ where: { organizationId: org, active: true }, orderBy: { name: "asc" }, take: 80 });
      return ok(rows.map((p) => ({ id: p.id, name: p.name, durationMin: p.durationMin, price: p.priceCents > 0 ? money(p.priceCents) : "sob consulta", kind: p.kind, sessions: p.sessions })));
    }

    case "list_professionals": {
      const rows = await prisma.professional.findMany({ where: { organizationId: org, active: true }, orderBy: { createdAt: "asc" }, take: 50 });
      return ok(rows.map((p) => ({ id: p.id, name: p.name, specialty: p.specialty })));
    }

    case "get_availability": {
      const input = z.object({ procedureId: z.string().min(1), professionalId: z.string().min(1).optional(), from: z.string().optional(), to: z.string().optional() }).parse(rawInput);
      const result = await getAvailability(org, { ...input, limit: 12 });
      return ok(result);
    }

    case "book_appointment": {
      const input = z.object({ start: z.string().min(10), procedureId: z.string().min(1), professionalId: z.string().min(1).optional(), notes: z.string().max(500).optional() }).parse(rawInput);
      const booked = await bookAppointment(org, {
        startAt: input.start,
        procedureId: input.procedureId,
        professionalId: input.professionalId,
        notes: input.notes,
        ...(ctx.contactId ? { contactId: ctx.contactId } : { contact: { name: "Paciente de teste" } }),
        idempotencyKey: idempotencyKey(ctx, "book", input.start, input.procedureId),
        bookingChannel: "ia",
        dryRun: ctx.dryRun || !ctx.contactId,
      });
      return ok(ctx.dryRun || !ctx.contactId ? { simulated: true, ...booked } : booked);
    }

    case "list_my_appointments": {
      if (!ctx.contactId) return ok([]);
      const [orgRow, rows] = await Promise.all([
        prisma.organization.findUnique({ where: { id: org }, select: { timezone: true } }),
        prisma.appointment.findMany({
          where: { organizationId: org, contactId: ctx.contactId, startAt: { gte: new Date() }, status: { in: ["SCHEDULED", "CONFIRMED"] } },
          orderBy: { startAt: "asc" },
          take: 10,
        }),
      ]);
      const tz = orgRow?.timezone ?? "America/Sao_Paulo";
      return ok(rows.map((a) => ({ id: a.id, title: a.title, start: toTzIso(a.startAt, tz), status: a.status })));
    }

    case "reschedule_appointment": {
      const input = z.object({ appointmentId: z.string().min(1), start: z.string().min(10) }).parse(rawInput);
      const appointment = await ownedAppointment(ctx, input.appointmentId);
      if (!appointment) return fail("agendamento_nao_encontrado", "Esse agendamento não existe ou não pertence a este cliente.");
      if (ctx.dryRun) return ok({ simulated: true, appointmentId: appointment.id, newStart: input.start });
      return ok(await rescheduleAppointment(org, appointment.id, { startAt: input.start }));
    }

    case "cancel_appointment": {
      const input = z.object({ appointmentId: z.string().min(1), reason: z.string().max(300).optional() }).parse(rawInput);
      const appointment = await ownedAppointment(ctx, input.appointmentId);
      if (!appointment) return fail("agendamento_nao_encontrado", "Esse agendamento não existe ou não pertence a este cliente.");
      if (ctx.dryRun) return ok({ simulated: true, appointmentId: appointment.id, status: "CANCELLED" });
      return ok(await cancelAppointment(org, appointment.id, { reason: input.reason ? `Cliente (via IA): ${input.reason}` : "Cliente (via IA)" }));
    }

    case "create_follow_up_task": {
      const input = z.object({ title: z.string().trim().min(3).max(160), notes: z.string().max(1000).optional(), dueInDays: z.number().int().min(0).max(60).optional() }).parse(rawInput);
      if (ctx.dryRun || !ctx.contactId) return ok({ simulated: true, task: input });
      await createHumanTask(ctx, input.title, input.notes, input.dueInDays ?? 1);
      return ok({ created: true });
    }

    case "handoff_to_human": {
      const input = z.object({ reason: z.string().trim().min(2).max(500) }).parse(rawInput);
      ctx.state.handoffReason = input.reason;
      return ok({ handoff: true, message: "Conversa passada para a equipe. Despeça-se com uma frase curta." });
    }

    default:
      return fail("ferramenta_desconhecida");
  }
}

/** Tarefa para a equipe, atribuída a quem já cuida da conversa/contato (se houver). */
export async function createHumanTask(ctx: Pick<ToolCtx, "organizationId" | "contactId" | "conversationId">, title: string, notes: string | undefined, dueInDays: number) {
  let assigneeId: string | null = null;
  if (ctx.conversationId) {
    const conv = await prisma.conversation.findFirst({ where: { id: ctx.conversationId, organizationId: ctx.organizationId }, select: { ownerId: true } });
    assigneeId = conv?.ownerId ?? null;
  }
  if (!assigneeId && ctx.contactId) {
    const contact = await prisma.contact.findFirst({ where: { id: ctx.contactId, organizationId: ctx.organizationId }, select: { ownerId: true } });
    assigneeId = contact?.ownerId ?? null;
  }
  await prisma.activity.create({
    data: {
      organizationId: ctx.organizationId,
      title: title.slice(0, 160),
      notes: notes ? `${notes}\n\n(Criada pelo agente de IA)` : "Criada pelo agente de IA",
      type: "TASK",
      dueAt: new Date(Date.now() + dueInDays * 86_400_000),
      contactId: ctx.contactId ?? undefined,
      assigneeId,
    },
  });
}
