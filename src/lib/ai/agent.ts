import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/prisma";
import { decryptJson } from "@/lib/crypto";
import { sendContactMessage } from "@/lib/messaging";
import { parseToolNames, DEFAULT_AI_MODEL, isAiModel } from "./models";
import { buildHistory, buildSystemBlocks, clampReply, endsWithCustomer, type ChatTurn } from "./prompt";
import { runAgentLoop, type ApiResponse, type LoopResult, type MessagesApi } from "./loop";
import { executeTool, toolDefsFor, createHumanTask, type ToolCtx } from "./tools";

// Agente de IA de atendimento. Fluxo de cada resposta:
//   mensagem do cliente → checagens (ativo, não pausado, limites) → histórico →
//   laço modelo/ferramentas → confere se nada mudou → envia pelo MESMO canal.
// Qualquer falha cai em "passar para um humano" (pausa a IA na conversa, cria
// tarefa e avisa o cliente uma única vez), nunca em silêncio.

export type AgentRunResult = {
  status: "replied" | "handoff" | "skipped" | "error";
  reason?: string;
  steps?: number;
  tokens?: number;
};

type Internal = AgentRunResult & { answeredInboundId?: string | null; stale?: boolean };

const MAX_RERUNS = 2;
const inflight = new Set<string>();

export function createApi(apiKey: string): MessagesApi {
  const client = new Anthropic({ apiKey, maxRetries: 2, timeout: 60_000 });
  return { create: (body) => client.beta.messages.create(body as never) as unknown as Promise<ApiResponse> };
}

/** Ponto de troca para testes (cliente falso no lugar da API real). */
export const deps = { createApi };

/** Texto seguro (sem chave nem detalhes internos) para mostrar ao administrador. */
export function describeProviderError(error: unknown): string {
  if (error instanceof Anthropic.AuthenticationError) return "Chave de API recusada pela Anthropic. Confira a chave do agente.";
  if (error instanceof Anthropic.PermissionDeniedError) return "A chave não tem permissão para este modelo.";
  if (error instanceof Anthropic.NotFoundError) return "Modelo não encontrado para esta chave.";
  if (error instanceof Anthropic.RateLimitError) return "Limite de uso da Anthropic atingido. Tente de novo em instantes ou aumente o limite da conta.";
  if (error instanceof Anthropic.BadRequestError) return `Pedido recusado pela Anthropic: ${error.message}`.slice(0, 240);
  if (error instanceof Anthropic.APIConnectionError) return "Sem conexão com a Anthropic (tempo esgotado ou rede).";
  if (error instanceof Anthropic.APIError) return `Erro ${error.status ?? ""} da Anthropic.`.trim();
  return "Erro inesperado ao chamar a IA.";
}

export async function testConnection(apiKey: string, model: string) {
  try {
    const client = new Anthropic({ apiKey, maxRetries: 1, timeout: 20_000 });
    await client.models.retrieve(model);
    return { ok: true as const };
  } catch (error) {
    return { ok: false as const, error: describeProviderError(error) };
  }
}

async function recordUsage(args: {
  organizationId: string;
  agentId: string;
  contactId: string | null;
  outcome: "replied" | "handoff" | "skipped" | "error" | "test";
  loop?: Pick<LoopResult, "steps" | "usage">;
  detail?: string;
}) {
  try {
    await prisma.aiUsage.create({
      data: {
        organizationId: args.organizationId,
        agentId: args.agentId,
        contactId: args.contactId,
        outcome: args.outcome,
        steps: args.loop?.steps ?? 0,
        inputTokens: args.loop?.usage.input ?? 0,
        outputTokens: args.loop?.usage.output ?? 0,
        cacheReadTokens: args.loop?.usage.cacheRead ?? 0,
        detail: args.detail?.slice(0, 500),
      },
    });
  } catch (error) {
    console.error("[ai] falha ao registrar uso:", error);
  }
}

async function noteAgentError(agentId: string, message: string | null) {
  await prisma.aiAgent
    .update({ where: { id: agentId }, data: { lastError: message, lastErrorAt: message ? new Date() : null } })
    .catch(() => {});
}

/**
 * Responde ao cliente com o agente. Chamada pela ação "Agente de IA" das
 * automações. Mensagens que chegam enquanto ainda responde não geram respostas
 * em paralelo: a execução corrente confere, ao terminar, se há mensagem nova.
 */
export async function respondWithAgent(input: { organizationId: string; contactId: string; agentId: string; connectionId?: string }): Promise<AgentRunResult> {
  const key = `${input.agentId}:${input.contactId}:${input.connectionId ?? "default"}`;
  if (inflight.has(key)) return { status: "skipped", reason: "já existe uma resposta em andamento para este contato" };
  inflight.add(key);
  try {
    let result = await respondOnce(input);
    for (let rerun = 0; rerun < MAX_RERUNS && result.stale; rerun++) result = await respondOnce(input);
    return result;
  } finally {
    inflight.delete(key);
  }
}

async function respondOnce(input: { organizationId: string; contactId: string; agentId: string; connectionId?: string }): Promise<Internal> {
  const { organizationId, contactId, agentId } = input;
  const skipped = (reason: string): Internal => ({ status: "skipped", reason });

  const agent = await prisma.aiAgent.findFirst({ where: { id: agentId, organizationId } });
  if (!agent) return skipped("agente de IA não encontrado");
  if (!agent.enabled) return skipped("agente de IA desativado");

  const [contact, org, lastInbound] = await Promise.all([
    prisma.contact.findFirst({ where: { id: contactId, organizationId }, select: { id: true, name: true } }),
    prisma.organization.findUnique({ where: { id: organizationId }, select: { name: true, timezone: true } }),
    prisma.message.findFirst({
      where: { organizationId, contactId, direction: "in", ...(input.connectionId ? { connectionId: input.connectionId } : {}) },
      orderBy: { time: "desc" },
      select: { id: true, time: true, conversationId: true },
    }),
  ]);
  if (!contact || !org) return skipped("contato ou empresa não encontrados");
  if (!lastInbound?.conversationId) return skipped("sem mensagem do cliente para responder");

  const conversation = await prisma.conversation.findFirst({
    where: { id: lastInbound.conversationId, organizationId },
    select: { id: true, aiPausedAt: true, connectionId: true },
  });
  if (!conversation) return skipped("conversa não encontrada");
  if (conversation.aiPausedAt) return skipped("IA pausada nesta conversa (atendimento humano)");

  // ── Freios de custo e de laço (bot × bot) ──
  const hourAgo = new Date(Date.now() - 3_600_000);
  const repliesLastHour = await prisma.aiUsage.count({
    where: { agentId, contactId, outcome: { in: ["replied", "handoff"] }, createdAt: { gte: hourAgo } },
  });
  if (repliesLastHour >= agent.replyLimitPerHour) {
    await handoff({ organizationId, contactId, conversationId: conversation.id, connectionId: conversation.connectionId, agent, reason: `Limite de ${agent.replyLimitPerHour} respostas da IA por hora atingido para este contato (possível laço com outro robô).`, notify: false });
    await recordUsage({ organizationId, agentId, contactId, outcome: "skipped", detail: "limite por hora" });
    return skipped("limite de respostas por hora atingido — conversa passada para a equipe");
  }
  if (agent.dailyTokenLimit > 0) {
    const sum = await prisma.aiUsage.aggregate({ where: { agentId, createdAt: { gte: new Date(Date.now() - 86_400_000) } }, _sum: { inputTokens: true, outputTokens: true } });
    if ((sum._sum.inputTokens ?? 0) + (sum._sum.outputTokens ?? 0) >= agent.dailyTokenLimit) {
      return skipped("limite diário de tokens do agente atingido");
    }
  }

  // ── Histórico ──
  const rows = await prisma.message.findMany({
    where: { organizationId, contactId, conversationId: conversation.id },
    orderBy: { time: "desc" },
    take: Math.max(agent.historyLimit, 1) * 3,
    select: { direction: true, text: true, time: true },
  });
  const turns = buildHistory(rows.reverse(), agent.historyLimit);
  if (!endsWithCustomer(turns)) return skipped("a equipe já respondeu por último");

  const connection = conversation.connectionId
    ? await prisma.connection.findFirst({ where: { id: conversation.connectionId, organizationId }, select: { label: true } })
    : null;

  const enabled = new Set<string>(parseToolNames(agent.tools));
  const ctx: ToolCtx = { organizationId, contactId, conversationId: conversation.id, dryRun: false, runKey: `${conversation.id}:${lastInbound.id}`, enabled, counts: {}, state: {} };

  let loop: LoopResult;
  try {
    const apiKey = decryptJson<string>(agent.apiKey);
    loop = await runAgentLoop({
      api: deps.createApi(apiKey),
      model: isAiModel(agent.model) ? agent.model : DEFAULT_AI_MODEL,
      effort: agent.effort,
      system: buildSystemBlocks({ orgName: org.name, timezone: org.timezone, now: new Date(), instructions: agent.systemPrompt, contactFirstName: contact.name.split(" ")[0] || null, channelLabel: connection?.label ?? null }),
      messages: turns.map((t) => ({ role: t.role, content: t.content })),
      tools: toolDefsFor(enabled),
      execute: (name, toolInput) => executeTool(ctx, name, toolInput),
      maxSteps: agent.maxToolSteps,
    });
    await noteAgentError(agentId, null);
  } catch (error) {
    const reason = describeProviderError(error);
    console.error("[ai] falha ao chamar o modelo:", error instanceof Error ? error.message : error);
    await noteAgentError(agentId, reason);
    await recordUsage({ organizationId, agentId, contactId, outcome: "error", detail: reason });
    await handoff({ organizationId, contactId, conversationId: conversation.id, connectionId: conversation.connectionId, agent, reason: `A IA não conseguiu responder: ${reason}`, notify: true });
    return { status: "error", reason };
  }

  const wantsHandoff = !!ctx.state.handoffReason;
  const failed = loop.outcome !== "replied";

  // ── Antes de enviar: algo mudou enquanto a IA pensava? ──
  const [newerInbound, humanReplied, pausedNow] = await Promise.all([
    prisma.message.findFirst({ where: { organizationId, contactId, conversationId: conversation.id, direction: "in", time: { gt: lastInbound.time } }, select: { id: true } }),
    prisma.message.findFirst({ where: { organizationId, contactId, conversationId: conversation.id, direction: "out", senderId: { not: null }, time: { gt: lastInbound.time } }, select: { id: true } }),
    prisma.conversation.findFirst({ where: { id: conversation.id, organizationId, aiPausedAt: { not: null } }, select: { id: true } }),
  ]);
  if (humanReplied || pausedNow) {
    await recordUsage({ organizationId, agentId, contactId, outcome: "skipped", loop, detail: "um atendente assumiu durante a resposta" });
    return skipped("um atendente assumiu a conversa; resposta da IA descartada");
  }
  if (newerInbound) {
    await recordUsage({ organizationId, agentId, contactId, outcome: "skipped", loop, detail: "chegou mensagem nova durante a resposta" });
    return { status: "skipped", reason: "chegou mensagem nova; refazendo a resposta", stale: true };
  }

  if (failed && !wantsHandoff) {
    const why = loop.outcome === "refusal" ? "a IA recusou responder" : loop.outcome === "max_steps" ? "a IA excedeu o limite de passos" : loop.outcome === "truncated" ? "a resposta da IA foi cortada" : "a IA não gerou texto";
    await recordUsage({ organizationId, agentId, contactId, outcome: "error", loop, detail: why });
    await handoff({ organizationId, contactId, conversationId: conversation.id, connectionId: conversation.connectionId, agent, reason: `Passado para a equipe: ${why}.`, notify: true });
    return { status: "error", reason: why, steps: loop.steps, tokens: loop.usage.input + loop.usage.output };
  }

  const text = clampReply(loop.text) || (wantsHandoff ? agent.handoffMessage : "");
  if (!text) return skipped("resposta vazia");

  const sent = await sendContactMessage(organizationId, contactId, text, conversation.connectionId ? { connectionId: conversation.connectionId } : {});
  if (!sent.ok || sent.status === "failed") {
    const error = sent.ok ? sent.error ?? "falha no envio" : sent.error;
    await recordUsage({ organizationId, agentId, contactId, outcome: "error", loop, detail: `envio: ${error}` });
    await createHumanTask(ctx, "Responder cliente manualmente (a IA não conseguiu enviar)", error, 0);
    return { status: "error", reason: `não foi possível enviar: ${error}`, steps: loop.steps };
  }

  if (wantsHandoff) {
    await handoff({ organizationId, contactId, conversationId: conversation.id, connectionId: conversation.connectionId, agent, reason: ctx.state.handoffReason ?? "Pedido de atendimento humano", notify: false });
  }
  await recordUsage({ organizationId, agentId, contactId, outcome: wantsHandoff ? "handoff" : "replied", loop });
  return { status: wantsHandoff ? "handoff" : "replied", steps: loop.steps, tokens: loop.usage.input + loop.usage.output, answeredInboundId: lastInbound.id };
}

/** Pausa a IA na conversa, abre tarefa para a equipe e (opcionalmente) avisa o cliente. */
async function handoff(args: {
  organizationId: string;
  contactId: string;
  conversationId: string;
  connectionId: string | null;
  agent: { handoffMessage: string };
  reason: string;
  notify: boolean;
}) {
  await prisma.conversation.updateMany({ where: { id: args.conversationId, organizationId: args.organizationId }, data: { aiPausedAt: new Date() } });
  await createHumanTask({ organizationId: args.organizationId, contactId: args.contactId, conversationId: args.conversationId }, "Atendimento humano necessário (IA)", args.reason, 0);
  if (args.notify) {
    await sendContactMessage(args.organizationId, args.contactId, args.agent.handoffMessage, args.connectionId ? { connectionId: args.connectionId } : {}).catch(() => {});
  }
}

/** Libera a IA de novo numa conversa (botão "Retomar IA"). */
export async function resumeAiInConversation(organizationId: string, conversationId: string) {
  await prisma.conversation.updateMany({ where: { id: conversationId, organizationId }, data: { aiPausedAt: null } });
}

// ── Modo de teste (playground): nada é enviado nem gravado na agenda/ficha ──

export type TestTurn = ChatTurn;

export async function runAgentTest(input: { organizationId: string; agentId: string; turns: TestTurn[] }) {
  const agent = await prisma.aiAgent.findFirst({ where: { id: input.agentId, organizationId: input.organizationId } });
  if (!agent) return { ok: false as const, error: "Agente não encontrado." };
  const turns = input.turns.filter((t) => t.content.trim()).slice(-20);
  if (!endsWithCustomer(turns)) return { ok: false as const, error: "Escreva uma mensagem como se fosse o cliente." };

  const org = await prisma.organization.findUnique({ where: { id: input.organizationId }, select: { name: true, timezone: true } });
  if (!org) return { ok: false as const, error: "Empresa não encontrada." };

  const enabled = new Set<string>(parseToolNames(agent.tools));
  const ctx: ToolCtx = { organizationId: input.organizationId, contactId: null, conversationId: null, dryRun: true, runKey: `teste:${Date.now()}`, enabled, counts: {}, state: {} };
  try {
    const loop = await runAgentLoop({
      api: deps.createApi(decryptJson<string>(agent.apiKey)),
      model: isAiModel(agent.model) ? agent.model : DEFAULT_AI_MODEL,
      effort: agent.effort,
      system: buildSystemBlocks({ orgName: org.name, timezone: org.timezone, now: new Date(), instructions: agent.systemPrompt, contactFirstName: "Cliente", channelLabel: "Teste" }),
      messages: turns.map((t) => ({ role: t.role, content: t.content })),
      tools: toolDefsFor(enabled),
      execute: (name, toolInput) => executeTool(ctx, name, toolInput),
      maxSteps: agent.maxToolSteps,
    });
    await recordUsage({ organizationId: input.organizationId, agentId: agent.id, contactId: null, outcome: "test", loop });
    await noteAgentError(agent.id, null);
    return {
      ok: true as const,
      reply: clampReply(loop.text) || (ctx.state.handoffReason ? agent.handoffMessage : ""),
      outcome: loop.outcome,
      handoffReason: ctx.state.handoffReason ?? null,
      trace: loop.trace,
      tokens: loop.usage.input + loop.usage.output,
    };
  } catch (error) {
    const reason = describeProviderError(error);
    await noteAgentError(agent.id, reason);
    return { ok: false as const, error: reason };
  }
}
