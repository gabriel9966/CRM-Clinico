"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdminUser, requireOrgUser } from "@/lib/auth";
import { actorOf, audit } from "@/lib/audit";
import { decryptJson, encryptJson } from "@/lib/crypto";
import { rateLimit } from "@/lib/rate-limit";
import { AI_TOOL_NAMES, DEFAULT_AI_MODEL, isAiEffort, isAiModel } from "@/lib/ai/models";
import { resumeAiInConversation, runAgentTest, testConnection } from "@/lib/ai/agent";
import type { Flow } from "@/lib/automation/types";
import { TRIGGER_LABEL } from "@/lib/automation/types";

export type AiResult<T extends object = object> = ({ ok: true } & T) | { ok: false; error: string };

const agentSchema = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(2, "Dê um nome ao agente.").max(80),
  enabled: z.boolean(),
  model: z.string().refine(isAiModel, "Modelo inválido."),
  effort: z.string().refine(isAiEffort, "Esforço inválido."),
  systemPrompt: z.string().max(8000, "As instruções passam de 8.000 caracteres."),
  apiKey: z.string().trim().max(300).optional(),
  tools: z.array(z.string()).max(30),
  maxToolSteps: z.number().int().min(1).max(10),
  historyLimit: z.number().int().min(4).max(40),
  replyLimitPerHour: z.number().int().min(1).max(200),
  dailyTokenLimit: z.number().int().min(0).max(100_000_000),
  handoffMessage: z.string().trim().min(5, "Escreva a mensagem de transferência.").max(500),
});

export type AiAgentInput = z.input<typeof agentSchema>;

function firstIssue(error: z.ZodError) {
  return error.issues[0]?.message ?? "Dados inválidos.";
}

export async function saveAiAgent(input: AiAgentInput): Promise<AiResult<{ id: string }>> {
  const user = await requireAdminUser();
  const { organizationId } = user;
  const parsed = agentSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  const data = parsed.data;

  const tools = JSON.stringify(data.tools.filter((name) => (AI_TOOL_NAMES as string[]).includes(name)));
  const key = data.apiKey?.trim();
  if (key && !key.startsWith("sk-ant-")) return { ok: false, error: "A chave da Anthropic começa com “sk-ant-”. Copie-a em console.anthropic.com." };

  const common = {
    name: data.name,
    enabled: data.enabled,
    model: data.model || DEFAULT_AI_MODEL,
    effort: data.effort,
    systemPrompt: data.systemPrompt,
    tools,
    maxToolSteps: data.maxToolSteps,
    historyLimit: data.historyLimit,
    replyLimitPerHour: data.replyLimitPerHour,
    dailyTokenLimit: data.dailyTokenLimit,
    handoffMessage: data.handoffMessage,
  };

  let id: string;
  if (data.id) {
    const existing = await prisma.aiAgent.findFirst({ where: { id: data.id, organizationId }, select: { id: true } });
    if (!existing) return { ok: false, error: "Agente não encontrado." };
    await prisma.aiAgent.update({
      where: { id: data.id },
      data: { ...common, ...(key ? { apiKey: encryptJson(key), apiKeyHint: key.slice(-4), lastError: null, lastErrorAt: null } : {}) },
    });
    id = data.id;
    await audit(organizationId, { action: "ai_agent.updated", entity: "AiAgent", entityId: id, ...actorOf(user), meta: { name: data.name, model: data.model, tools: data.tools, keyChanged: !!key } });
  } else {
    if (!key) return { ok: false, error: "Informe a chave de API da Anthropic." };
    const created = await prisma.aiAgent.create({ data: { ...common, organizationId, apiKey: encryptJson(key), apiKeyHint: key.slice(-4) } });
    id = created.id;
    await audit(organizationId, { action: "ai_agent.created", entity: "AiAgent", entityId: id, ...actorOf(user), meta: { name: data.name, model: data.model, tools: data.tools } });
  }
  revalidatePath("/ai");
  return { ok: true, id };
}

export async function deleteAiAgent(id: string): Promise<AiResult> {
  const user = await requireAdminUser();
  const { organizationId } = user;
  const agent = await prisma.aiAgent.findFirst({ where: { id, organizationId }, select: { id: true, name: true } });
  if (!agent) return { ok: false, error: "Agente não encontrado." };
  const using = await prisma.automation.findMany({ where: { organizationId, enabled: true, flow: { contains: id } }, select: { name: true } });
  if (using.length > 0) {
    return { ok: false, error: `Este agente está em uso pelas automações ativas: ${using.map((a) => a.name).join(", ")}. Pause ou edite-as antes de excluir.` };
  }
  await prisma.aiAgent.delete({ where: { id } });
  await audit(organizationId, { action: "ai_agent.deleted", entity: "AiAgent", entityId: id, ...actorOf(user), meta: { name: agent.name } });
  revalidatePath("/ai");
  return { ok: true };
}

/** Confere a chave e o modelo na Anthropic, sem gastar tokens. */
export async function checkAiAgentConnection(id: string): Promise<AiResult> {
  const { organizationId } = await requireAdminUser();
  const agent = await prisma.aiAgent.findFirst({ where: { id, organizationId } });
  if (!agent) return { ok: false, error: "Agente não encontrado." };
  const result = await testConnection(decryptJson<string>(agent.apiKey), agent.model);
  await prisma.aiAgent.update({ where: { id }, data: result.ok ? { lastError: null, lastErrorAt: null } : { lastError: result.error, lastErrorAt: new Date() } });
  revalidatePath("/ai");
  return result.ok ? { ok: true } : { ok: false, error: result.error };
}

/** Playground: conversa de teste como se fosse o cliente. Não envia nada nem grava na agenda. */
export async function chatWithAiAgent(id: string, turns: { role: "user" | "assistant"; content: string }[]) {
  const user = await requireAdminUser();
  const limit = rateLimit(`ai-test:${user.id}`, { limit: 20, windowMs: 60_000 });
  if (!limit.ok) return { ok: false as const, error: "Muitos testes seguidos. Aguarde um instante." };
  const safeTurns = turns.slice(-20).map((t) => ({ role: t.role === "assistant" ? ("assistant" as const) : ("user" as const), content: String(t.content ?? "").slice(0, 2000) }));
  return runAgentTest({ organizationId: user.organizationId, agentId: id, turns: safeTurns });
}

/** Receita pronta: gatilho "Mensagem recebida" → ação "Agente de IA". Cria desativada para revisão. */
export async function createAiBotAutomation(agentId: string): Promise<AiResult<{ automationId: string }>> {
  const user = await requireAdminUser();
  const { organizationId } = user;
  const agent = await prisma.aiAgent.findFirst({ where: { id: agentId, organizationId }, select: { id: true, name: true } });
  if (!agent) return { ok: false, error: "Agente não encontrado." };
  const flow: Flow = {
    nodes: [
      { id: "trigger", type: "triggerNode", position: { x: 60, y: 160 }, data: { kind: "trigger", label: TRIGGER_LABEL.MESSAGE_RECEIVED } },
      { id: "ai", type: "actionNode", position: { x: 340, y: 160 }, data: { kind: "action", actionType: "ai_agent", config: { agentId: agent.id } } },
    ],
    edges: [{ id: "e1", source: "trigger", target: "ai" }],
  };
  const automation = await prisma.automation.create({
    data: { organizationId, name: `Chatbot: ${agent.name}`, trigger: "MESSAGE_RECEIVED", flow: JSON.stringify(flow), enabled: false },
  });
  await audit(organizationId, { action: "automation.created", entity: "Automation", entityId: automation.id, ...actorOf(user), meta: { trigger: "MESSAGE_RECEIVED", recipe: "ai_bot" } });
  revalidatePath("/automations");
  return { ok: true, automationId: automation.id };
}

// ── Conversa: pausar / retomar a IA ────────────────────────────────────────

export async function resumeAiAction(conversationId: string) {
  const { organizationId } = await requireOrgUser();
  await resumeAiInConversation(organizationId, conversationId);
  revalidatePath("/conversations");
}

export async function pauseAiAction(conversationId: string) {
  const { organizationId } = await requireOrgUser();
  await prisma.conversation.updateMany({ where: { id: conversationId, organizationId }, data: { aiPausedAt: new Date() } });
  revalidatePath("/conversations");
}
