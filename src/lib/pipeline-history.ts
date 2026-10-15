import "server-only";
import type { DbClient } from "./prisma";

type Tx = DbClient;

// Fecha o registro de histórico aberto (se houver) da oportunidade e abre um
// novo para a etapa de destino. Usado em todo ponto que muda Opportunity.stageId
// (drag-and-drop, edição manual, importação CSV, nó "mover de etapa" de automação,
// e reatribuição em massa ao apagar uma etapa) para alimentar métricas de
// velocity/conversão por etapa no dashboard.
export async function recordStageChange(
  tx: Tx,
  params: { organizationId: string; opportunityId: string; newStageId: string }
) {
  const { organizationId, opportunityId, newStageId } = params;

  const open = await tx.opportunityStageHistory.findFirst({
    where: { opportunityId, exitedAt: null },
    orderBy: { enteredAt: "desc" },
  });
  if (open?.stageId === newStageId) return; // já está na etapa, nada a fazer

  const now = new Date();
  if (open) {
    await tx.opportunityStageHistory.update({ where: { id: open.id }, data: { exitedAt: now } });
  }
  await tx.opportunityStageHistory.create({
    data: { organizationId, opportunityId, stageId: newStageId, enteredAt: now },
  });
}
