import "server-only";
import { prisma } from "@/lib/prisma";
import { mcpCreateContact, mcpCreateOpportunity, mcpSendMessage } from "@/lib/mcp-tools";
import { recordStageChange } from "@/lib/pipeline-history";
import { syncTags } from "@/lib/crm-catalog";
import { runCode } from "./sandbox";
import type { Flow, FlowNode, NodeData } from "./types";

type RunContext = {
  organizationId: string;
  contactId?: string | null;
  opportunityId?: string | null;
  appointmentId?: string | null;
  payload?: unknown;
};

type AppointmentTriggerContext = {
  id: string;
  contactId: string | null;
  ownerId: string | null;
  professionalId: string | null;
  procedureId: string | null;
  bookingChannel: string | null;
  startAt: Date | string;
  status: string;
};

function parseFlow(raw: string): Flow {
  try {
    const parsed = JSON.parse(raw);
    return { nodes: parsed.nodes ?? [], edges: parsed.edges ?? [] };
  } catch {
    return { nodes: [], edges: [] };
  }
}

function parseTags(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function payloadField(payload: unknown, path: string): unknown {
  if (!path || !/^[a-zA-Z0-9_.]+$/.test(path)) return undefined;
  let current: unknown = payload;
  for (const key of path.split(".")) {
    if (!key || key === "__proto__" || key === "constructor" || key === "prototype" || !current || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

function resolveTemplate(value: unknown, payload: unknown): string {
  return String(value ?? "").replace(/\{\{\s*payload\.([a-zA-Z0-9_.]+)\s*\}\}/g, (_, path: string) => {
    const resolved = payloadField(payload, path);
    return typeof resolved === "string" || typeof resolved === "number" ? String(resolved) : "";
  }).trim();
}

async function appendLog(runId: string, entry: Record<string, unknown>) {
  const run = await prisma.automationRun.findUnique({ where: { id: runId } });
  if (!run) return;
  let log: unknown[] = [];
  try {
    log = JSON.parse(run.log);
  } catch {
    log = [];
  }
  log.push({ ...entry, at: new Date().toISOString() });
  await prisma.automationRun.update({ where: { id: runId }, data: { log: JSON.stringify(log) } });
}

function outgoingEdge(flow: Flow, nodeId: string, handle?: string) {
  return flow.edges.find((e) => e.source === nodeId && (handle === undefined || (e.sourceHandle ?? null) === handle));
}

async function runActionNode(node: Extract<NodeData, { kind: "action" }>, ctx: RunContext) {
  const config = node.config as Record<string, string | number | undefined>;
  const orgId = ctx.organizationId;

  switch (node.actionType) {
    case "send_message": {
      if (!ctx.contactId || !config.text) return { ok: false, reason: "sem contato ou texto" };
      return mcpSendMessage(orgId, ctx.contactId, String(config.text));
    }
    case "create_task": {
      if (!ctx.contactId && !ctx.opportunityId) return { ok: false, reason: "sem contato/oportunidade" };
      const days = Number(config.dueInDays ?? 1);
      await prisma.activity.create({
        data: {
          organizationId: orgId,
          title: String(config.title ?? "Tarefa automática"),
          type: "TASK",
          dueAt: new Date(Date.now() + days * 86400000),
          contactId: ctx.contactId ?? undefined,
          opportunityId: ctx.opportunityId ?? undefined,
        },
      });
      return { ok: true };
    }
    case "move_stage": {
      if (!ctx.opportunityId || !config.stageId) return { ok: false, reason: "sem oportunidade/etapa" };
      const opp = await prisma.opportunity.findFirst({ where: { id: ctx.opportunityId, organizationId: orgId } });
      if (!opp) return { ok: false, reason: "oportunidade fora da organização" };
      const newStageId = String(config.stageId);
      await prisma.opportunity.update({ where: { id: ctx.opportunityId }, data: { stageId: newStageId } });
      await recordStageChange(prisma, { organizationId: orgId, opportunityId: ctx.opportunityId, newStageId });
      return { ok: true };
    }
    case "add_tag": {
      const tag = String(config.tag ?? "").trim();
      if (!tag) return { ok: false, reason: "sem tag" };
      const target = config.target === "opportunity" ? "opportunity" : "contact";
      await syncTags(orgId, [tag], target); // valida o escopo antes de alterar o registro
      if (target === "contact" && ctx.contactId) {
        const c = await prisma.contact.findFirst({ where: { id: ctx.contactId, organizationId: orgId } });
        if (c) {
          const tags = parseTags(c.tags);
          if (!tags.includes(tag)) {
            await prisma.contact.update({ where: { id: c.id }, data: { tags: JSON.stringify([...tags, tag]) } });
          }
        }
      } else if (target === "opportunity" && ctx.opportunityId) {
        const o = await prisma.opportunity.findFirst({ where: { id: ctx.opportunityId, organizationId: orgId } });
        if (o) {
          const tags = parseTags(o.tags);
          if (!tags.includes(tag)) {
            await prisma.opportunity.update({ where: { id: o.id }, data: { tags: JSON.stringify([...tags, tag]) } });
          }
        }
      }
      return { ok: true };
    }
    case "assign_owner": {
      const ownerId = config.ownerId ? String(config.ownerId) : null;
      // só aceita atribuir a alguém da MESMA organização
      if (ownerId) {
        const member = await prisma.user.findFirst({ where: { id: ownerId, organizationId: orgId } });
        if (!member) return { ok: false, reason: "responsável fora da organização" };
      }
      const target = config.target === "opportunity" ? "opportunity" : "contact";
      if (target === "contact" && ctx.contactId) {
        await prisma.contact.updateMany({ where: { id: ctx.contactId, organizationId: orgId }, data: { ownerId } });
      } else if (target === "opportunity" && ctx.opportunityId) {
        await prisma.opportunity.updateMany({ where: { id: ctx.opportunityId, organizationId: orgId }, data: { ownerId } });
      }
      return { ok: true };
    }
    case "webhook": {
      if (!config.url) return { ok: false, reason: "sem url" };
      try {
        const response = await fetch(String(config.url), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contactId: ctx.contactId, opportunityId: ctx.opportunityId, firedAt: new Date().toISOString() }),
        });
        return response.ok ? { ok: true } : { ok: false, reason: `webhook retornou HTTP ${response.status}` };
      } catch (err) {
        return { ok: false, reason: err instanceof Error ? err.message : "falha no webhook" };
      }
    }
    case "create_contact": {
      const name = resolveTemplate(config.name, ctx.payload);
      if (!name) return { ok: false, reason: "nome do contato vazio; confira o campo do payload" };
      const created = await mcpCreateContact(orgId, {
        name,
        email: resolveTemplate(config.email, ctx.payload) || undefined,
        phone: resolveTemplate(config.phone, ctx.payload) || undefined,
        company: resolveTemplate(config.company, ctx.payload) || undefined,
      });
      ctx.contactId = created.id;
      return { ok: true, contactId: created.id };
    }
    case "create_opportunity": {
      if (!ctx.contactId) return { ok: false, reason: "sem contato para criar oportunidade" };
      if (!config.pipelineId || !config.stageId) return { ok: false, reason: "selecione pipeline e etapa" };
      const title = resolveTemplate(config.title, ctx.payload);
      if (!title) return { ok: false, reason: "título da oportunidade vazio" };
      const created = await mcpCreateOpportunity(orgId, {
        title,
        contactId: ctx.contactId,
        pipelineId: String(config.pipelineId),
        stageId: String(config.stageId),
        value: Number(config.value ?? 0),
      });
      if ("error" in created) return { ok: false, reason: created.error };
      ctx.opportunityId = created.id;
      return { ok: true, opportunityId: created.id };
    }
    default:
      return { ok: false, reason: "ação desconhecida" };
  }
}

async function evaluateCondition(data: Extract<NodeData, { kind: "condition" }>, ctx: RunContext): Promise<boolean> {
  const { field, operator, value, path } = data;
  const orgId = ctx.organizationId;

  if (field === "payload_field") {
    const actual = payloadField(ctx.payload, path ?? "");
    if (operator === "exists") return actual !== undefined && actual !== null && actual !== "";
    const text = String(actual ?? "");
    if (operator === "not_equals") return text !== value;
    if (operator === "contains") return text.includes(value);
    if (operator === "not_contains") return !text.includes(value);
    return text === value;
  }

  if (field === "contact_tag") {
    if (!ctx.contactId) return false;
    const c = await prisma.contact.findFirst({ where: { id: ctx.contactId, organizationId: orgId } });
    const tags = c ? parseTags(c.tags) : [];
    return operator === "not_equals" || operator === "not_contains" ? !tags.includes(value) : tags.includes(value);
  }
  if (field === "contact_name" || field === "contact_email" || field === "contact_phone" || field === "contact_company") {
    if (!ctx.contactId) return false;
    const contact = await prisma.contact.findFirst({ where: { id: ctx.contactId, organizationId: orgId } });
    if (!contact) return false;
    const text = String(({ contact_name: contact.name, contact_email: contact.email, contact_phone: contact.phone, contact_company: contact.company })[field] ?? "");
    if (operator === "exists") return text.length > 0;
    if (operator === "not_equals") return text !== value;
    if (operator === "contains") return text.includes(value);
    if (operator === "not_contains") return !text.includes(value);
    return text === value;
  }
  if (field === "opportunity_value") {
    if (!ctx.opportunityId) return false;
    const o = await prisma.opportunity.findFirst({ where: { id: ctx.opportunityId, organizationId: orgId } });
    if (!o) return false;
    const num = Number(value);
    if (operator === "gt") return o.value > num;
    if (operator === "lt") return o.value < num;
    return o.value === num;
  }
  if (field === "stage_label") {
    if (!ctx.opportunityId) return false;
    const o = await prisma.opportunity.findFirst({ where: { id: ctx.opportunityId, organizationId: orgId }, include: { stage: true } });
    if (!o) return false;
    return operator === "not_equals" ? o.stage.label !== value : o.stage.label === value;
  }
  return false;
}

async function executeFrom(flow: Flow, runId: string, startNodeId: string, ctx: RunContext) {
  let nodeId: string | undefined = startNodeId;

  while (nodeId) {
    const node: FlowNode | undefined = flow.nodes.find((n) => n.id === nodeId);
    if (!node) break;

    if (node.data.kind === "action") {
      const result = await runActionNode(node.data, ctx);
      await appendLog(runId, { nodeId: node.id, label: `Ação: ${node.data.actionType}`, result });
      if (!result.ok) {
        await prisma.automationRun.update({ where: { id: runId }, data: { status: "FAILED", finishedAt: new Date() } });
        return;
      }
      if (node.data.actionType === "create_contact" || node.data.actionType === "create_opportunity") {
        await prisma.automationRun.update({ where: { id: runId }, data: { contactId: ctx.contactId ?? null, opportunityId: ctx.opportunityId ?? null } });
      }
      const edge = outgoingEdge(flow, node.id);
      nodeId = edge?.target;
      continue;
    }

    if (node.data.kind === "condition") {
      const result = await evaluateCondition(node.data, ctx);
      await appendLog(runId, { nodeId: node.id, label: "Condição", result });
      const edge = outgoingEdge(flow, node.id, result ? "true" : "false");
      nodeId = edge?.target;
      continue;
    }

    if (node.data.kind === "delay") {
      const ms =
        node.data.unit === "minutes" ? node.data.amount * 60000 : node.data.unit === "hours" ? node.data.amount * 3600000 : node.data.amount * 86400000;
      const runAt = new Date(Date.now() + ms);
      const { scheduleResume } = await import("./queue");
      const jobId = await scheduleResume(runId, ms);
      await prisma.automationSchedule.create({ data: { automationRunId: runId, nodeId: node.id, runAt, jobId } });
      await prisma.automationRun.update({ where: { id: runId }, data: { status: "WAITING", currentNodeId: node.id } });
      await appendLog(runId, { nodeId: node.id, label: "Espera", result: { until: runAt.toISOString() } });
      return; // pausa aqui; o worker da fila retoma depois
    }

    if (node.data.kind === "code") {
      const outcome = await runCode(node.data.code, ctx);
      await appendLog(runId, { nodeId: node.id, label: "Código JS", result: outcome });
      if (!outcome.ok) {
        await prisma.automationRun.update({ where: { id: runId }, data: { status: "FAILED", finishedAt: new Date() } });
        return;
      }
      const edge = outgoingEdge(flow, node.id);
      nodeId = edge?.target;
      continue;
    }

    break; // nó trigger não deveria aparecer no meio do fluxo
  }

  await prisma.automationRun.update({ where: { id: runId }, data: { status: "COMPLETED", finishedAt: new Date() } });
}

/** Nunca deixa uma execução presa em "executando". O erro fica registrado no
 * próprio histórico da automação e não interrompe o webhook ou a operação do
 * CRM que a disparou. */
async function executeWithFailureTracking(flow: Flow, runId: string, startNodeId: string, ctx: RunContext) {
  try {
    await executeFrom(flow, runId, startNodeId, ctx);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "erro desconhecido";
    await appendLog(runId, { label: "Falha da execução", result: { ok: false, reason } });
    await prisma.automationRun.update({ where: { id: runId }, data: { status: "FAILED", finishedAt: new Date() } });
  }
}

export async function triggerAutomations(
  organizationId: string,
  trigger: string,
  ctx: {
    contactId?: string | null;
    opportunityId?: string | null;
    appointmentId?: string | null;
    appointment?: AppointmentTriggerContext;
    payload?: unknown;
    pipelineId?: string;
    stageId?: string;
    tag?: string;
    /** Uso interno do agendador: evita que uma regra dispare as demais. */
    onlyAutomationId?: string;
  }
) {
  // O cliente Prisma sempre devolve um array; a proteção também permite que
  // integrações opcionais não interrompam o evento caso a consulta falhe em um
  // adaptador de teste.
  const automations = (await prisma.automation.findMany({
    where: { organizationId, trigger: trigger as never, enabled: true },
  })) ?? [];

  for (const automation of automations) {
    if (ctx.onlyAutomationId && automation.id !== ctx.onlyAutomationId) continue;
    let config: Record<string, unknown> = {};
    try {
      config = JSON.parse(automation.triggerConfig);
    } catch {
      config = {};
    }

    if (trigger === "STAGE_CHANGED") {
      if (config.pipelineId && config.pipelineId !== ctx.pipelineId) continue;
      if (config.stageId && config.stageId !== ctx.stageId) continue;
    }
    if (trigger === "TAG_ADDED" && config.tag && config.tag !== ctx.tag) continue;
    if (trigger.startsWith("APPOINTMENT_") && ctx.appointment) {
      if (config.ownerId && config.ownerId !== ctx.appointment.ownerId) continue;
      if (config.professionalId && config.professionalId !== ctx.appointment.professionalId) continue;
      if (config.procedureId && config.procedureId !== ctx.appointment.procedureId) continue;
      if (config.bookingChannel && config.bookingChannel !== ctx.appointment.bookingChannel) continue;
    }

    const flow = parseFlow(automation.flow);
    const triggerNode = flow.nodes.find((n) => n.data.kind === "trigger");
    if (!triggerNode) continue;
    const firstEdge = outgoingEdge(flow, triggerNode.id);
    if (!firstEdge) continue;

    let run;
    try {
      run = await prisma.automationRun.create({
        data: {
          automationId: automation.id,
          contactId: ctx.contactId ?? null,
          opportunityId: ctx.opportunityId ?? null,
          appointmentId: ctx.appointmentId ?? null,
          appointmentStartAt: trigger === "APPOINTMENT_STARTING" && ctx.appointment ? new Date(ctx.appointment.startAt) : null,
          payload: ctx.payload !== undefined ? JSON.stringify(ctx.payload) : null,
          status: "RUNNING",
        },
      });
    } catch (error) {
      // O agendador pode passar pelo mesmo minuto duas vezes; a restrição única
      // por automação/agendamento evita envio duplicado de lembrete.
      if (ctx.appointmentId && typeof error === "object" && error && (error as { code?: string }).code === "P2002") continue;
      throw error;
    }

    await executeWithFailureTracking(flow, run.id, firstEdge.target, {
      organizationId,
      contactId: ctx.contactId,
      opportunityId: ctx.opportunityId,
      appointmentId: ctx.appointmentId,
      payload: ctx.payload,
    });
  }
}

/** Porta única dos eventos da agenda. O payload chega completo ao fluxo como
 * `payload.appointment`, enquanto o contato vinculado fica disponível às ações
 * usuais (mensagem, tarefa, tags e negócio). */
export async function triggerAppointmentAutomations(
  organizationId: string,
  trigger: "APPOINTMENT_CREATED" | "APPOINTMENT_RESCHEDULED" | "APPOINTMENT_CANCELLED" | "APPOINTMENT_CONFIRMED" | "APPOINTMENT_NO_SHOW" | "APPOINTMENT_STARTING",
  appointment: AppointmentTriggerContext,
  onlyAutomationId?: string
) {
  await triggerAutomations(organizationId, trigger, {
    contactId: appointment.contactId,
    appointmentId: appointment.id,
    appointment,
    payload: { appointment: { ...appointment, startAt: new Date(appointment.startAt).toISOString() } },
    onlyAutomationId,
  });
}

// Dispara uma automação específica pelo id (usado pelo gatilho de webhook,
// já que cada automação desse tipo tem a própria URL — não precisa varrer
// todas as automações procurando qual bate com o gatilho). A organização é
// sempre a dona da automação, nunca algo vindo do payload externo.
export async function runAutomationById(automationId: string, payload: unknown) {
  const automation = await prisma.automation.findUnique({ where: { id: automationId } });
  if (!automation || !automation.enabled || automation.trigger !== "WEBHOOK_RECEIVED") {
    return { ok: false, reason: "automação não encontrada, desativada ou não é do tipo webhook" };
  }

  const flow = parseFlow(automation.flow);
  const triggerNode = flow.nodes.find((n) => n.data.kind === "trigger");
  if (!triggerNode) return { ok: false, reason: "fluxo sem gatilho" };
  const firstEdge = outgoingEdge(flow, triggerNode.id);
  if (!firstEdge) return { ok: false, reason: "gatilho sem nada conectado" };

  // Se o payload do webhook trouxer contactId/opportunityId, liga eles
  // automaticamente ao contexto — mas só se pertencerem à mesma organização
  // da automação (nunca confiar cegamente em id vindo de fora).
  let contactId: string | undefined;
  let opportunityId: string | undefined;
  if (payload && typeof payload === "object") {
    const p = payload as Record<string, unknown>;
    if (typeof p.contactId === "string") {
      const c = await prisma.contact.findFirst({ where: { id: p.contactId, organizationId: automation.organizationId } });
      if (c) contactId = c.id;
    }
    if (typeof p.opportunityId === "string") {
      const o = await prisma.opportunity.findFirst({ where: { id: p.opportunityId, organizationId: automation.organizationId } });
      if (o) opportunityId = o.id;
    }
  }

  const run = await prisma.automationRun.create({
    data: {
      automationId: automation.id,
      payload: JSON.stringify(payload),
      contactId: contactId ?? null,
      opportunityId: opportunityId ?? null,
      appointmentId: null,
      status: "RUNNING",
    },
  });

  await executeWithFailureTracking(flow, run.id, firstEdge.target, { organizationId: automation.organizationId, payload, contactId, opportunityId });
  return { ok: true, runId: run.id };
}

// Chamado pelo worker da fila (BullMQ) quando um job de espera vence, pra
// retomar a execução de onde parou.
export async function resumeAutomationRun(runId: string) {
  const run = await prisma.automationRun.findUnique({ where: { id: runId }, include: { automation: true, schedule: true } });
  if (!run || !run.schedule) return;

  await prisma.automationSchedule.delete({ where: { id: run.schedule.id } }).catch(() => {});

  const flow = parseFlow(run.automation.flow);
  const edge = outgoingEdge(flow, run.schedule.nodeId);
  if (!edge) {
    await prisma.automationRun.update({ where: { id: run.id }, data: { status: "COMPLETED", finishedAt: new Date() } });
    return;
  }
  await prisma.automationRun.update({ where: { id: run.id }, data: { status: "RUNNING" } });
  let payload: unknown;
  try {
    payload = run.payload ? JSON.parse(run.payload) : undefined;
  } catch {
    payload = undefined;
  }
  await executeWithFailureTracking(flow, run.id, edge.target, {
    organizationId: run.automation.organizationId,
    contactId: run.contactId,
    opportunityId: run.opportunityId,
    appointmentId: run.appointmentId,
    payload,
  });
}

// Fallback: processa agendamentos vencidos diretamente no banco (usado só se
// a fila Redis/BullMQ não estiver configurada — veja ./queue.ts).
export async function processDueSchedulesFallback() {
  const due = await prisma.automationSchedule.findMany({ where: { runAt: { lte: new Date() } } });
  for (const schedule of due) {
    await resumeAutomationRun(schedule.automationRunId);
  }
}

/**
 * Gatilhos avaliados periodicamente. Esta primeira versão é deliberadamente
 * simples e auditável: "inatividade" usa a última mensagem do contato e
 * "data" usa uma data/hora fixa configurada na automação.
 */
export async function processDueTriggerAutomations() {
  const now = new Date();
  const automations = await prisma.automation.findMany({
    where: {
      enabled: true,
      trigger: { in: ["CONTACT_INACTIVE", "DATE_REACHED"] },
    },
  });

  for (const automation of automations) {
    let config: Record<string, unknown> = {};
    try {
      config = JSON.parse(automation.triggerConfig);
    } catch {
      // Configuração vazia mantém os valores-padrão seguros abaixo.
    }

    if (automation.trigger === "DATE_REACHED") {
      const dateAt = typeof config.dateAt === "string" ? new Date(config.dateAt) : null;
      if (!dateAt || Number.isNaN(dateAt.getTime()) || dateAt > now || automation.lastTriggeredAt) continue;
      await triggerAutomations(automation.organizationId, "DATE_REACHED", { onlyAutomationId: automation.id });
      await prisma.automation.update({ where: { id: automation.id }, data: { lastTriggeredAt: now } });
      continue;
    }

    const inactivityDays = Math.max(1, Math.min(3650, Number(config.inactivityDays ?? 3) || 3));
    const repeatHours = Math.max(1, Math.min(24 * 30, Number(config.repeatHours ?? 24) || 24));
    if (automation.lastTriggeredAt && now.getTime() - automation.lastTriggeredAt.getTime() < repeatHours * 3_600_000) continue;

    const cutoff = new Date(now.getTime() - inactivityDays * 86_400_000);
    const contacts = await prisma.contact.findMany({
      where: {
        organizationId: automation.organizationId,
        deletedAt: null,
        OR: [
          { lastMessageAt: { lte: cutoff } },
          { lastMessageAt: null, createdAt: { lte: cutoff } },
        ],
      },
      select: { id: true },
      take: 2_000,
    });

    for (const contact of contacts) {
      await triggerAutomations(automation.organizationId, "CONTACT_INACTIVE", {
        contactId: contact.id,
        onlyAutomationId: automation.id,
      });
    }
    await prisma.automation.update({ where: { id: automation.id }, data: { lastTriggeredAt: now } });
  }

  // Lembretes ligados ao começo do agendamento. A execução fica vinculada ao
  // id do agendamento, por isso cada regra só dispara uma vez para ele mesmo
  // que este processo rode a cada minuto ou o servidor reinicie.
  const appointmentAutomations = await prisma.automation.findMany({
    where: { enabled: true, trigger: "APPOINTMENT_STARTING" },
    select: { id: true, organizationId: true, triggerConfig: true },
  });
  for (const automation of appointmentAutomations) {
    let config: Record<string, unknown> = {};
    try { config = JSON.parse(automation.triggerConfig); } catch { config = {}; }
    const minutesBefore = Math.max(1, Math.min(7 * 24 * 60, Number(config.minutesBefore ?? 60) || 60));
    const until = new Date(now.getTime() + minutesBefore * 60_000);
    const appointments = await prisma.appointment.findMany({
      where: {
        organizationId: automation.organizationId,
        deletedAt: null,
        status: { in: ["SCHEDULED", "CONFIRMED"] },
        startAt: { gte: now, lte: until },
      },
      select: { id: true, contactId: true, ownerId: true, professionalId: true, procedureId: true, bookingChannel: true, startAt: true, status: true },
      take: 500,
    });
    for (const appointment of appointments) {
      await triggerAppointmentAutomations(automation.organizationId, "APPOINTMENT_STARTING", appointment, automation.id);
    }
  }
}
