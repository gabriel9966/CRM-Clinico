"use server";

import { revalidatePath } from "next/cache";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireOrgUser } from "@/lib/auth";
import { triggerAutomations } from "@/lib/automation/engine";
import { parseCsv } from "@/lib/csv";
import { recordStageChange } from "@/lib/pipeline-history";
import { actorOf, audit } from "@/lib/audit";
import { softDeleteOpportunity } from "@/lib/soft-delete";
import type { ImportSummary } from "@/app/contacts/actions";

const DEFAULT_STAGES = [
  { label: "Novo Lead", color: "#64748b" },
  { label: "Contato Feito", color: "#2563eb" },
  { label: "Proposta Enviada", color: "#7c3aed" },
  { label: "Negociação", color: "#ea580c" },
  { label: "Ganho", color: "#16a34a" },
  { label: "Perdido", color: "#dc2626" },
];

export async function createPipeline(name: string) {
  const { organizationId } = await requireOrgUser();
  const trimmed = name.trim();
  if (!trimmed) return;

  await prisma.pipeline.create({
    data: {
      organizationId,
      name: trimmed,
      stages: {
        create: DEFAULT_STAGES.map((s, i) => ({ label: s.label, color: s.color, order: i })),
      },
    },
  });
  revalidatePath("/pipeline");
}

export async function renamePipeline(pipelineId: string, name: string) {
  const { organizationId } = await requireOrgUser();
  const trimmed = name.trim();
  if (!trimmed) return;
  await prisma.pipeline.updateMany({ where: { id: pipelineId, organizationId }, data: { name: trimmed } });
  revalidatePath("/pipeline");
}

export async function deletePipeline(pipelineId: string) {
  const { organizationId } = await requireOrgUser();
  const count = await prisma.pipeline.count({ where: { organizationId } });
  if (count <= 1) return;
  await prisma.pipeline.deleteMany({ where: { id: pipelineId, organizationId } });
  revalidatePath("/pipeline");
}

async function assertPipelineInOrg(pipelineId: string, organizationId: string) {
  return prisma.pipeline.findFirst({ where: { id: pipelineId, organizationId } });
}

export async function addStage(pipelineId: string) {
  const { organizationId } = await requireOrgUser();
  if (!(await assertPipelineInOrg(pipelineId, organizationId))) return;

  const last = await prisma.stage.findFirst({ where: { pipelineId }, orderBy: { order: "desc" } });
  await prisma.stage.create({
    data: {
      pipelineId,
      label: "Nova etapa",
      color: "#64748b",
      order: (last?.order ?? -1) + 1,
    },
  });
  revalidatePath("/pipeline");
}

export async function renameStage(stageId: string, label: string) {
  const { organizationId } = await requireOrgUser();
  const trimmed = label.trim();
  if (!trimmed) return;
  const stage = await prisma.stage.findFirst({ where: { id: stageId }, include: { pipeline: true } });
  if (!stage || stage.pipeline.organizationId !== organizationId) return;
  await prisma.stage.update({ where: { id: stageId }, data: { label: trimmed } });
  revalidatePath("/pipeline");
}

export async function setStageColor(stageId: string, color: string) {
  const { organizationId } = await requireOrgUser();
  const stage = await prisma.stage.findFirst({ where: { id: stageId }, include: { pipeline: true } });
  if (!stage || stage.pipeline.organizationId !== organizationId) return;
  await prisma.stage.update({ where: { id: stageId }, data: { color } });
  revalidatePath("/pipeline");
}

export async function moveStage(pipelineId: string, stageId: string, direction: -1 | 1) {
  const { organizationId } = await requireOrgUser();
  if (!(await assertPipelineInOrg(pipelineId, organizationId))) return;

  const stages = await prisma.stage.findMany({ where: { pipelineId }, orderBy: { order: "asc" } });
  const idx = stages.findIndex((s) => s.id === stageId);
  const newIdx = idx + direction;
  if (idx === -1 || newIdx < 0 || newIdx >= stages.length) return;

  const a = stages[idx];
  const b = stages[newIdx];
  await prisma.$transaction([
    prisma.stage.update({ where: { id: a.id }, data: { order: b.order } }),
    prisma.stage.update({ where: { id: b.id }, data: { order: a.order } }),
  ]);
  revalidatePath("/pipeline");
}

export async function deleteStage(pipelineId: string, stageId: string) {
  const { organizationId } = await requireOrgUser();
  if (!(await assertPipelineInOrg(pipelineId, organizationId))) return;

  const stages = await prisma.stage.findMany({ where: { pipelineId }, orderBy: { order: "asc" } });
  if (stages.length <= 1) return;
  const remaining = stages.filter((s) => s.id !== stageId);
  const fallbackId = remaining[0].id;

  const affected = await prisma.opportunity.findMany({ where: { stageId }, select: { id: true } });

  await prisma.$transaction(async (tx) => {
    for (const { id } of affected) {
      await tx.opportunity.update({ where: { id }, data: { stageId: fallbackId } });
      await recordStageChange(tx, { organizationId, opportunityId: id, newStageId: fallbackId });
    }
    await tx.stage.delete({ where: { id: stageId } });
  });
  revalidatePath("/pipeline");
}

export type OpportunityInput = {
  title: string;
  value: number;
  tags: string[];
  contactId: string;
  pipelineId: string;
  stageId: string;
  ownerId: string | null;
  expectedClose: string | null;
  lossReasonId?: string | null;
  customFields?: Record<string, unknown>;
};

// Os ids vêm do navegador, então não dá para confiar neles: sem esta conferência
// um usuário poderia ligar um negócio a um contato, funil ou atendente de OUTRA
// empresa. Tudo precisa pertencer à organização da sessão.
async function assertOpportunityRefs(organizationId: string, data: OpportunityInput) {
  const [contact, stage, owner, lossReason] = await Promise.all([
    prisma.contact.findFirst({ where: { id: data.contactId, organizationId }, select: { id: true } }),
    prisma.stage.findFirst({
      where: { id: data.stageId, pipelineId: data.pipelineId, pipeline: { organizationId } },
      select: { id: true },
    }),
    data.ownerId
      ? prisma.user.findFirst({ where: { id: data.ownerId, organizationId }, select: { id: true } })
      : Promise.resolve(true),
    data.lossReasonId
      ? prisma.lossReason.findFirst({ where: { id: data.lossReasonId, organizationId, active: true }, select: { id: true, name: true } })
      : Promise.resolve(null),
  ]);
  if (!contact) throw new Error("Contato inválido.");
  if (!stage) throw new Error("Etapa inválida para este pipeline.");
  if (!owner) throw new Error("Responsável inválido.");
  if (data.lossReasonId && !lossReason) throw new Error("Motivo de perda inválido.");
  return lossReason;
}

export async function createOpportunity(data: OpportunityInput) {
  const { organizationId } = await requireOrgUser();
  const lossReason = await assertOpportunityRefs(organizationId, data);
  const opp = await prisma.opportunity.create({
    data: {
      organizationId,
      title: data.title,
      value: data.value,
      tags: JSON.stringify(data.tags),
      contactId: data.contactId,
      pipelineId: data.pipelineId,
      stageId: data.stageId,
      ownerId: data.ownerId,
      expectedClose: data.expectedClose ? new Date(data.expectedClose) : null,
      ...(data.lossReasonId !== undefined ? { lossReasonId: lossReason?.id ?? null, lossReason: lossReason?.name ?? null } : {}),
      customFields: (data.customFields ?? {}) as Prisma.InputJsonValue,
    },
  });
  await recordStageChange(prisma, { organizationId, opportunityId: opp.id, newStageId: opp.stageId });
  revalidatePath("/pipeline");
  await triggerAutomations(organizationId, "OPPORTUNITY_CREATED", { contactId: opp.contactId, opportunityId: opp.id });
  await triggerAutomations(organizationId, "STAGE_CHANGED", {
    contactId: opp.contactId,
    opportunityId: opp.id,
    pipelineId: opp.pipelineId,
    stageId: opp.stageId,
  });
}

export async function updateOpportunity(id: string, data: OpportunityInput) {
  const { organizationId } = await requireOrgUser();
  const before = await prisma.opportunity.findFirst({ where: { id, organizationId } });
  if (!before) return;
  const lossReason = await assertOpportunityRefs(organizationId, data);

  const opp = await prisma.opportunity.update({
    where: { id },
    data: {
      title: data.title,
      value: data.value,
      tags: JSON.stringify(data.tags),
      contactId: data.contactId,
      pipelineId: data.pipelineId,
      stageId: data.stageId,
      ownerId: data.ownerId,
      expectedClose: data.expectedClose ? new Date(data.expectedClose) : null,
      ...(data.lossReasonId !== undefined ? { lossReasonId: lossReason?.id ?? null, lossReason: lossReason?.name ?? null } : {}),
      customFields: (data.customFields ?? {}) as Prisma.InputJsonValue,
    },
  });
  revalidatePath("/pipeline");
  if (before.stageId !== opp.stageId) {
    await recordStageChange(prisma, { organizationId, opportunityId: opp.id, newStageId: opp.stageId });
    await triggerAutomations(organizationId, "STAGE_CHANGED", {
      contactId: opp.contactId,
      opportunityId: opp.id,
      pipelineId: opp.pipelineId,
      stageId: opp.stageId,
    });
  }
}

export async function deleteOpportunity(id: string) {
  const user = await requireOrgUser();
  const { organizationId } = user;
  const res = await softDeleteOpportunity(prisma, organizationId, id);
  if (res.count > 0) {
    await audit(organizationId, { action: "opportunity.deleted", entity: "Opportunity", entityId: id, ...actorOf(user) });
  }
  revalidatePath("/pipeline");
  revalidatePath("/trash");
}

// Importa oportunidades de um CSV com colunas: title, value, contact_email
// (ou contact_name), pipeline (nome, opcional — usa defaultPipelineId se
// vazio/sem match), stage (nome da etapa, opcional — usa a primeira etapa),
// owner (nome do atendente, opcional), tags (;), expected_close (AAAA-MM-DD).
// O contato precisa já existir (por e-mail ou nome) — a importação não cria
// contatos novos, pra evitar duplicar cadastros por erro de digitação.
export async function importOpportunitiesCsv(csvText: string, defaultPipelineId: string): Promise<ImportSummary> {
  const { organizationId } = await requireOrgUser();
  const rows = parseCsv(csvText);

  // Carrega só os contatos citados no CSV (por e-mail ou nome), em vez de todos
  // os da organização — e-mails/nomes são comparados sem diferenciar maiúsculas.
  const wantedEmails = [...new Set(rows.map((r) => (r.contact_email || "").trim().toLowerCase()).filter(Boolean))];
  const wantedNames = [...new Set(rows.map((r) => (r.contact_name || "").trim().toLowerCase()).filter(Boolean))];
  const contacts: { id: string; name: string; email: string | null }[] = [];
  const CHUNK = 200;
  for (let i = 0; i < wantedEmails.length; i += CHUNK) {
    contacts.push(
      ...(await prisma.contact.findMany({
        where: { organizationId, OR: wantedEmails.slice(i, i + CHUNK).map((email) => ({ email: { equals: email, mode: "insensitive" as const } })) },
        select: { id: true, name: true, email: true },
      }))
    );
  }
  for (let i = 0; i < wantedNames.length; i += CHUNK) {
    contacts.push(
      ...(await prisma.contact.findMany({
        where: { organizationId, OR: wantedNames.slice(i, i + CHUNK).map((name) => ({ name: { equals: name, mode: "insensitive" as const } })) },
        select: { id: true, name: true, email: true },
      }))
    );
  }
  const [team, pipelines] = await Promise.all([
    prisma.user.findMany({ where: { organizationId }, select: { id: true, name: true } }),
    prisma.pipeline.findMany({ where: { organizationId }, include: { stages: { orderBy: { order: "asc" } } } }),
  ]);

  let created = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const [i, row] of rows.entries()) {
    const title = (row.title || "").trim();
    const line = i + 2;
    if (!title) {
      skipped++;
      errors.push(`Linha ${line}: sem título, pulada.`);
      continue;
    }

    const contact =
      (row.contact_email && contacts.find((c) => c.email?.toLowerCase() === row.contact_email.toLowerCase())) ||
      (row.contact_name && contacts.find((c) => c.name.toLowerCase() === row.contact_name.toLowerCase()));
    if (!contact) {
      skipped++;
      errors.push(`Linha ${line}: contato "${row.contact_email || row.contact_name || "?"}" não encontrado.`);
      continue;
    }

    const pipeline = (row.pipeline && pipelines.find((p) => p.name.toLowerCase() === row.pipeline.toLowerCase())) ||
      pipelines.find((p) => p.id === defaultPipelineId) ||
      pipelines[0];
    if (!pipeline) {
      skipped++;
      errors.push(`Linha ${line}: nenhum pipeline disponível.`);
      continue;
    }

    const stage =
      (row.stage && pipeline.stages.find((s) => s.label.toLowerCase() === row.stage.toLowerCase())) ||
      pipeline.stages[0];
    if (!stage) {
      skipped++;
      errors.push(`Linha ${line}: pipeline "${pipeline.name}" não tem etapas.`);
      continue;
    }

    const owner = row.owner ? team.find((m) => m.name.toLowerCase() === row.owner.toLowerCase()) : undefined;
    const tags = (row.tags || "").split(";").map((t) => t.trim()).filter(Boolean);
    const value = Number(row.value);

    const newOpp = await prisma.opportunity.create({
      data: {
        organizationId,
        title,
        value: Number.isFinite(value) ? value : 0,
        tags: JSON.stringify(tags),
        contactId: contact.id,
        pipelineId: pipeline.id,
        stageId: stage.id,
        ownerId: owner?.id ?? null,
        expectedClose: row.expected_close ? new Date(row.expected_close) : null,
      },
    });
    await recordStageChange(prisma, { organizationId, opportunityId: newOpp.id, newStageId: stage.id });
    created++;
  }

  revalidatePath("/pipeline");
  return { created, skipped, errors };
}

export async function moveOpportunityStage(id: string, stageId: string) {
  const { organizationId } = await requireOrgUser();
  const existing = await prisma.opportunity.findFirst({ where: { id, organizationId } });
  if (!existing) return;
  // A etapa de destino precisa ser do mesmo pipeline (e da mesma organização).
  const target = await prisma.stage.findFirst({
    where: { id: stageId, pipelineId: existing.pipelineId, pipeline: { organizationId } },
    select: { id: true },
  });
  if (!target) throw new Error("Etapa inválida para este pipeline.");

  const opp = await prisma.opportunity.update({ where: { id }, data: { stageId } });
  await recordStageChange(prisma, { organizationId, opportunityId: opp.id, newStageId: opp.stageId });
  revalidatePath("/pipeline");
  await triggerAutomations(organizationId, "STAGE_CHANGED", {
    contactId: opp.contactId,
    opportunityId: opp.id,
    pipelineId: opp.pipelineId,
    stageId: opp.stageId,
  });
}
