import "server-only";
import { prisma } from "./prisma";
import { triggerAutomations } from "./automation/engine";

// Gatilhos de automação para o que entra pela API pública (/api/v1) e pelo MCP:
// um lead criado pelo n8n ou por um agente de IA precisa disparar as mesmas
// automações que um lead criado na tela. Fica fora de mcp-tools de propósito:
// o motor de automação também usa mcp-tools, e disparar gatilhos lá dentro
// deixaria uma automação acionar a si mesma em laço.

export async function contactCreatedViaApi(organizationId: string, contactId: string, tags: string[] = []) {
  await triggerAutomations(organizationId, "CONTACT_CREATED", { contactId });
  for (const tag of new Set(tags)) await triggerAutomations(organizationId, "TAG_ADDED", { contactId, tag });
}

export async function opportunityCreatedViaApi(organizationId: string, opportunityId: string) {
  const opp = await prisma.opportunity.findFirst({ where: { id: opportunityId, organizationId } });
  if (!opp) return;
  await triggerAutomations(organizationId, "OPPORTUNITY_CREATED", { contactId: opp.contactId, opportunityId: opp.id });
  await triggerAutomations(organizationId, "STAGE_CHANGED", { contactId: opp.contactId, opportunityId: opp.id, pipelineId: opp.pipelineId, stageId: opp.stageId });
}

export async function stageChangedViaApi(organizationId: string, opportunityId: string, previousStageId: string) {
  const opp = await prisma.opportunity.findFirst({ where: { id: opportunityId, organizationId } });
  if (!opp || opp.stageId === previousStageId) return;
  await triggerAutomations(organizationId, "STAGE_CHANGED", { contactId: opp.contactId, opportunityId: opp.id, pipelineId: opp.pipelineId, stageId: opp.stageId });
}

/** Etapa atual, para comparar depois de uma alteração vinda da API. */
export async function currentStageId(organizationId: string, opportunityId: string) {
  return (await prisma.opportunity.findFirst({ where: { id: opportunityId, organizationId }, select: { stageId: true } }))?.stageId ?? null;
}
