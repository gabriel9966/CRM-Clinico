import "server-only";
import { prisma } from "./prisma";
import { AppError } from "./errors";

export type StagePolicyData = { title?: string; value?: number; ownerId?: string | null; expectedClose?: unknown; lossReasonId?: string | null; customFields?: Record<string, unknown> | unknown };
const list = (raw?: string) => { try { const value = JSON.parse(raw || "[]"); return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []; } catch { return []; } };

/** Shared by UI, imports, API, MCP and automation, always within a pipeline. */
export async function enforceStagePolicy(organizationId: string, pipelineId: string, stageId: string, data: StagePolicyData, actor?: { role: string; team: string }) {
  const stage = await prisma.stage.findFirst({ where: { id: stageId, pipelineId, pipeline: { organizationId } } });
  if (!stage) throw new AppError("etapa_invalida", "Etapa inválida para este pipeline.", 400);
  const teams = list(stage.allowedTeams);
  if (actor && actor.role !== "ADMIN" && teams.length && !teams.includes(actor.team)) throw new AppError("sem_permissao", "Seu time não tem permissão para esta etapa.", 403);
  if ((stage.status === "LOST" || stage.requireLossReason) && !data.lossReasonId) throw new AppError("motivo_obrigatorio", "Informe o motivo de perda para entrar nesta etapa.", 400);
  if (data.lossReasonId && !(await prisma.lossReason.findFirst({ where: { id: data.lossReasonId, organizationId, active: true } }))) throw new AppError("motivo_invalido", "Motivo de perda inválido.", 400);
  const custom = data.customFields && typeof data.customFields === "object" ? data.customFields as Record<string, unknown> : {};
  const missing = list(stage.requiredFields).filter((field) => {
    if (field === "title") return !data.title?.trim();
    if (field === "value") return !Number.isFinite(data.value) || Number(data.value) <= 0;
    if (field === "ownerId") return !data.ownerId;
    if (field === "expectedClose") return !data.expectedClose;
    return custom[field] === undefined || custom[field] === null || custom[field] === "";
  });
  if (missing.length) throw new AppError("campos_obrigatorios", `Preencha os campos obrigatórios: ${missing.join(", ")}.`, 400);
  return stage;
}
