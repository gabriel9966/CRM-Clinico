import "server-only";
import { prisma } from "@/lib/prisma";
import { parseToolNames, type AiToolName } from "./models";

export type AiAgentDTO = {
  id: string;
  name: string;
  enabled: boolean;
  model: string;
  effort: string;
  systemPrompt: string;
  /** Últimos caracteres da chave (a chave em si nunca sai do servidor). */
  apiKeyHint: string;
  tools: AiToolName[];
  maxToolSteps: number;
  historyLimit: number;
  replyLimitPerHour: number;
  dailyTokenLimit: number;
  handoffMessage: string;
  lastError: string | null;
  lastErrorAt: string | null;
  usage30d: { replies: number; handoffs: number; errors: number; tokens: number };
  /** Automações que usam este agente (nome). */
  usedBy: string[];
};

export async function getAiAgents(organizationId: string): Promise<AiAgentDTO[]> {
  const since = new Date(Date.now() - 30 * 86_400_000);
  const [agents, usage, automations] = await Promise.all([
    prisma.aiAgent.findMany({ where: { organizationId }, orderBy: { createdAt: "asc" } }),
    prisma.aiUsage.groupBy({
      by: ["agentId", "outcome"],
      where: { organizationId, createdAt: { gte: since } },
      _count: { _all: true },
      _sum: { inputTokens: true, outputTokens: true },
    }),
    prisma.automation.findMany({ where: { organizationId }, select: { name: true, flow: true } }),
  ]);

  return agents.map((agent) => {
    const rows = usage.filter((u) => u.agentId === agent.id);
    const count = (outcome: string) => rows.find((r) => r.outcome === outcome)?._count._all ?? 0;
    return {
      id: agent.id,
      name: agent.name,
      enabled: agent.enabled,
      model: agent.model,
      effort: agent.effort,
      systemPrompt: agent.systemPrompt,
      apiKeyHint: agent.apiKeyHint,
      tools: parseToolNames(agent.tools),
      maxToolSteps: agent.maxToolSteps,
      historyLimit: agent.historyLimit,
      replyLimitPerHour: agent.replyLimitPerHour,
      dailyTokenLimit: agent.dailyTokenLimit,
      handoffMessage: agent.handoffMessage,
      lastError: agent.lastError,
      lastErrorAt: agent.lastErrorAt?.toISOString() ?? null,
      usage30d: {
        replies: count("replied"),
        handoffs: count("handoff"),
        errors: count("error"),
        tokens: rows.filter((r) => r.outcome !== "test").reduce((sum, r) => sum + (r._sum.inputTokens ?? 0) + (r._sum.outputTokens ?? 0), 0),
      },
      usedBy: automations.filter((a) => a.flow.includes(agent.id)).map((a) => a.name),
    };
  });
}

export async function listAiAgentOptions(organizationId: string) {
  const agents = await prisma.aiAgent.findMany({ where: { organizationId }, orderBy: { createdAt: "asc" }, select: { id: true, name: true, enabled: true } });
  return agents;
}
