import "server-only";
import { prisma } from "@/lib/prisma";
import { mcpSendMessage } from "@/lib/mcp-tools";
import { recordStageChange } from "@/lib/pipeline-history";
import { syncTags } from "@/lib/crm-catalog";
import { runCode } from "./sandbox";
import type { Flow, FlowNode, NodeData } from "./types";

type RunContext = {
  organizationId: string;
  contactId?: string | null;
  opportunityId?: string | null;
  payload?: unknown;
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
      await syncTags(orgId, [tag]).catch(() => {}); // mantém o catálogo de etiquetas completo
      const target = config.target === "opportunity" ? "opportunity" : "contact";
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
        await fetch(String(config.url), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contactId: ctx.contactId, opportunityId: ctx.opportunityId, firedAt: new Date().toISOString() }),
        });
        return { ok: true };
      } catch (err) {
        return { ok: false, reason: err instanceof Error ? err.message : "falha no webhook" };
      }
    }
    default:
      return { ok: false, reason: "ação desconhecida" };
  }
}

async function evaluateCondition(data: Extract<NodeData, { kind: "condition" }>, ctx: RunContext): Promise<boolean> {
  const { field, operator, value } = data;
  const orgId = ctx.organizationId;

  if (field === "contact_tag") {
    if (!ctx.contactId) return false;
    const c = await prisma.contact.findFirst({ where: { id: ctx.contactId, organizationId: orgId } });
    const tags = c ? parseTags(c.tags) : [];
    return operator === "not_contains" ? !tags.includes(value) : tags.includes(value);
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
      const edge = outgoingEdge(flow, node.id);
      nodeId = edge?.target;
      continue;
    }

    break; // nó trigger não deveria aparecer no meio do fluxo
  }

  await prisma.automationRun.update({ where: { id: runId }, data: { status: "COMPLETED", finishedAt: new Date() } });
}

export async function triggerAutomations(
  organizationId: string,
  trigger: string,
  ctx: {
    contactId?: string | null;
    opportunityId?: string | null;
    payload?: unknown;
    pipelineId?: string;
    stageId?: string;
    tag?: string;
    /** Uso interno do agendador: evita que uma regra dispare as demais. */
    onlyAutomationId?: string;
  }
) {
  const automations = await prisma.automation.findMany({ where: { organizationId, trigger: trigger as never, enabled: true } });

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

    const flow = parseFlow(automation.flow);
    const triggerNode = flow.nodes.find((n) => n.data.kind === "trigger");
    if (!triggerNode) continue;
    const firstEdge = outgoingEdge(flow, triggerNode.id);
    if (!firstEdge) continue;

    const run = await prisma.automationRun.create({
      data: {
        automationId: automation.id,
        contactId: ctx.contactId ?? null,
        opportunityId: ctx.opportunityId ?? null,
        payload: ctx.payload !== undefined ? JSON.stringify(ctx.payload) : null,
        status: "RUNNING",
      },
    });

    try {
      await executeFrom(flow, run.id, firstEdge.target, {
        organizationId,
        contactId: ctx.contactId,
        opportunityId: ctx.opportunityId,
        payload: ctx.payload,
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : "erro desconhecido";
      await appendLog(run.id, { label: "Falha da execução", result: { ok: false, reason } });
      await prisma.automationRun.update({ where: { id: run.id }, data: { status: "FAILED", finishedAt: new Date() } });
    }
  }
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
      status: "RUNNING",
    },
  });

  await executeFrom(flow, run.id, firstEdge.target, { organizationId: automation.organizationId, payload, contactId, opportunityId });
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
  await executeFrom(flow, run.id, edge.target, {
    organizationId: run.automation.organizationId,
    contactId: run.contactId,
    opportunityId: run.opportunityId,
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
      take: 500,
    });

    for (const contact of contacts) {
      await triggerAutomations(automation.organizationId, "CONTACT_INACTIVE", {
        contactId: contact.id,
        onlyAutomationId: automation.id,
      });
    }
    await prisma.automation.update({ where: { id: automation.id }, data: { lastTriggeredAt: now } });
  }
}
