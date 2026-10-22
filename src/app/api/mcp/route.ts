import { NextRequest } from "next/server";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import {
  mcpListContacts,
  mcpGetContact,
  mcpCreateContact,
  mcpListPipelines,
  mcpListOpportunities,
  mcpCreateOpportunity,
  mcpMoveOpportunityStage,
  mcpListTeam,
  mcpSendMessage,
} from "@/lib/mcp-tools";
import { resolveOrgByMcpApiKey } from "@/lib/mcp-config";
import { clientIp } from "@/lib/rate-limit";
import { sharedRateLimit } from "@/lib/shared-rate-limit";
import { listProfessionals, listProcedures } from "@/lib/scheduling/catalog";
import { AppError } from "@/lib/errors";
import { contactCreatedViaApi, currentStageId, opportunityCreatedViaApi, stageChangedViaApi } from "@/lib/api-events";
import {
  getAvailability,
  bookAppointment,
  rescheduleAppointment,
  cancelAppointment,
} from "@/lib/scheduling/service";

// Expõe o CRM como um servidor MCP (Model Context Protocol), para que agentes
// de IA (Claude, etc.) consigam ler e escrever contatos, pipeline e conversas.
// Autenticação: Authorization: Bearer <chave>. Cada organização tem a própria
// chave (gerenciada na tela "Integração MCP") — a chave usada determina de
// qual empresa os dados lidos/escritos vêm, nunca misturando entre empresas.

async function resolveOrg(req: NextRequest): Promise<string | null> {
  const auth = req.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) return null;
  return resolveOrgByMcpApiKey(token);
}

function text(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

function buildServer(organizationId: string) {
  const server = new McpServer({ name: "novacrm", version: "1.0.0" });

  server.registerTool(
    "list_contacts",
    {
      title: "Listar contatos",
      description: "Lista contatos do CRM, com busca opcional por nome, empresa ou e-mail.",
      inputSchema: { search: z.string().optional() },
    },
    async ({ search }) => run(() => mcpListContacts(organizationId, search))
  );

  server.registerTool(
    "get_contact",
    {
      title: "Detalhar contato",
      description: "Retorna um contato com suas oportunidades e mensagens recentes.",
      inputSchema: { contactId: z.string() },
    },
    async ({ contactId }) => run(() => mcpGetContact(organizationId, contactId))
  );

  server.registerTool(
    "create_contact",
    {
      title: "Criar contato",
      description: "Cria um novo contato no CRM.",
      inputSchema: {
        name: z.string(),
        company: z.string().optional(),
        email: z.string().optional(),
        phone: z.string().optional(),
        tags: z.array(z.string()).optional(),
        notes: z.string().optional(),
        ownerId: z.string().optional(),
      },
    },
    async (input) =>
      run(async () => {
        const created = await mcpCreateContact(organizationId, input);
        await contactCreatedViaApi(organizationId, created.id, input.tags);
        return created;
      })
  );

  server.registerTool(
    "list_pipelines",
    {
      title: "Listar pipelines",
      description: "Lista os pipelines de vendas e suas etapas.",
      inputSchema: {},
    },
    async () => run(() => mcpListPipelines(organizationId))
  );

  server.registerTool(
    "list_opportunities",
    {
      title: "Listar oportunidades",
      description: "Lista oportunidades, com filtros opcionais por pipeline, etapa ou contato.",
      inputSchema: {
        pipelineId: z.string().optional(),
        stageId: z.string().optional(),
        contactId: z.string().optional(),
      },
    },
    async (filter) => run(() => mcpListOpportunities(organizationId, filter))
  );

  server.registerTool(
    "create_opportunity",
    {
      title: "Criar oportunidade",
      description: "Cria uma nova oportunidade vinculada a um contato, pipeline e etapa.",
      inputSchema: {
        title: z.string(),
        contactId: z.string(),
        pipelineId: z.string(),
        stageId: z.string(),
        value: z.number().optional(),
        ownerId: z.string().optional(),
      },
    },
    async (input) =>
      run(async () => {
        const created = await mcpCreateOpportunity(organizationId, input);
        if ("id" in created && created.id) await opportunityCreatedViaApi(organizationId, created.id);
        return created;
      })
  );

  server.registerTool(
    "move_opportunity_stage",
    {
      title: "Mover oportunidade de etapa",
      description: "Move uma oportunidade para outra etapa do pipeline.",
      inputSchema: { opportunityId: z.string(), stageId: z.string() },
    },
    async ({ opportunityId, stageId }) =>
      run(async () => {
        const before = await currentStageId(organizationId, opportunityId);
        const moved = await mcpMoveOpportunityStage(organizationId, opportunityId, stageId);
        if (moved.ok && before) await stageChangedViaApi(organizationId, opportunityId, before);
        return moved;
      })
  );

  server.registerTool(
    "list_team",
    {
      title: "Listar equipe",
      description: "Lista os membros da equipe (atendentes) do CRM.",
      inputSchema: {},
    },
    async () => run(() => mcpListTeam(organizationId))
  );

  server.registerTool(
    "send_message",
    {
      title: "Enviar mensagem",
      description:
        "Envia uma mensagem para um contato por um canal real (WhatsApp, Instagram ou e-mail). Sem canal conectado devolve o motivo (sem_canal, canal_desconectado, escolha_canal…) e NÃO registra nada como enviado. Se o contato puder ser atendido por mais de um canal, informe connectionId.",
      inputSchema: { contactId: z.string(), text: z.string(), connectionId: z.string().optional() },
    },
    async ({ contactId, text: msg, connectionId }) => run(() => mcpSendMessage(organizationId, contactId, msg, connectionId))
  );

  // ── Agenda clínica ───────────────────────────────────────────────────────
  server.registerTool(
    "list_professionals",
    {
      title: "Listar profissionais",
      description: "Lista os profissionais que atendem (id, nome, especialidade, dias e horário de trabalho).",
      inputSchema: {},
    },
    async () => run(() => listProfessionals(organizationId))
  );

  server.registerTool(
    "list_procedures",
    {
      title: "Listar procedimentos",
      description: "Lista o catálogo de procedimentos com duração (min) e preço (centavos).",
      inputSchema: {},
    },
    async () => run(() => listProcedures(organizationId))
  );

  server.registerTool(
    "get_availability",
    {
      title: "Consultar horários livres",
      description:
        "Horários livres na agenda. Informe procedureId (ou durationMin). Datas YYYY-MM-DD no fuso da clínica; padrão: próximos 7 dias.",
      inputSchema: {
        from: z.string().optional(),
        to: z.string().optional(),
        procedureId: z.string().optional(),
        durationMin: z.number().int().optional(),
        professionalId: z.string().optional(),
        limit: z.number().int().optional(),
      },
    },
    async (input) => run(() => getAvailability(organizationId, input))
  );

  server.registerTool(
    "book_appointment",
    {
      title: "Agendar atendimento",
      description:
        "Agenda um atendimento num horário livre (use get_availability antes). Use idempotencyKey para poder repetir a chamada sem duplicar e dryRun para só validar.",
      inputSchema: {
        startAt: z.string(),
        procedureId: z.string().optional(),
        durationMin: z.number().int().optional(),
        professionalId: z.string().optional(),
        contactId: z.string().optional(),
        contact: z
          .object({ name: z.string(), phone: z.string().optional(), email: z.string().optional() })
          .optional(),
        notes: z.string().optional(),
        idempotencyKey: z.string().optional(),
        dryRun: z.boolean().optional(),
      },
    },
    async (input) =>
      run(() => bookAppointment(organizationId, { ...input, bookingChannel: "mcp" }))
  );

  server.registerTool(
    "reschedule_appointment",
    {
      title: "Remarcar atendimento",
      description: "Move um atendimento ativo para outro horário livre.",
      inputSchema: { appointmentId: z.string(), startAt: z.string(), professionalId: z.string().optional() },
    },
    async ({ appointmentId, ...rest }) =>
      run(() => rescheduleAppointment(organizationId, appointmentId, rest))
  );

  server.registerTool(
    "cancel_appointment",
    {
      title: "Cancelar atendimento",
      description: "Cancela um atendimento futuro. Repetir a chamada é seguro.",
      inputSchema: { appointmentId: z.string(), reason: z.string().optional() },
    },
    async ({ appointmentId, reason }) =>
      run(() => cancelAppointment(organizationId, appointmentId, { reason }))
  );

  return server;
}

// Toda ferramenta passa por aqui. Erro de regra (AppError, ou { error } /
// { ok: false } devolvido pela função) volta como resultado com isError e
// código estável, para o agente conseguir se corrigir (ex.: oferecer outro
// horário). Erro inesperado vira "erro_interno" sem detalhes do banco.
async function run(fn: () => Promise<unknown>) {
  try {
    const result = await fn();
    const failed = result === null || (typeof result === "object" && (("error" in result && (result as { error?: unknown }).error) || (result as { ok?: unknown }).ok === false));
    return failed ? { isError: true, ...text(result ?? { error: "nao_encontrado" }) } : text(result);
  } catch (err) {
    if (err instanceof AppError) {
      return { isError: true, ...text({ error: err.code, detail: err.message }) };
    }
    console.error("[mcp] erro na ferramenta:", err);
    return { isError: true, ...text({ error: "erro_interno", detail: "Não foi possível concluir a operação." }) };
  }
}

async function handle(req: NextRequest) {
  const rl = await sharedRateLimit(`mcp:ip:${clientIp(req.headers)}`, { limit: 300, windowMs: 60_000 });
  if (!rl.ok) {
    return new Response(JSON.stringify({ error: "rate_limited" }), {
      status: 429,
      headers: { "content-type": "application/json", "retry-after": String(rl.retryAfterSec) },
    });
  }

  const organizationId = await resolveOrg(req);
  if (!organizationId) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }

  const server = buildServer(organizationId);
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  await server.connect(transport);
  return transport.handleRequest(req);
}

export async function POST(req: NextRequest) {
  return handle(req);
}

export async function GET(req: NextRequest) {
  return handle(req);
}

export async function DELETE(req: NextRequest) {
  return handle(req);
}
