"use server";

import { revalidatePath } from "next/cache";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireAdminUser, requireOrgUser } from "@/lib/auth";
import { triggerAutomations } from "@/lib/automation/engine";
import { importDate, importMoney, importRows, importTags, phoneKey } from "@/lib/crm-import";
import { recordStageChange } from "@/lib/pipeline-history";
import { actorOf, audit } from "@/lib/audit";
import { softDeleteOpportunity } from "@/lib/soft-delete";
import { syncTags } from "@/lib/crm-catalog";
import { canAccessPipeline, hasModulePermission } from "@/lib/access";
import { enforceStagePolicy } from "@/lib/stage-policy";
import type { ImportSummary } from "@/app/contacts/actions";

export type OpportunityStageHistoryDTO = {
  id: string;
  stageId: string;
  stageLabel: string;
  stageColor: string;
  stageOrder: number;
  enteredAt: string;
  exitedAt: string | null;
};

/** Histórico append-only do funil. O tempo da etapa atual é calculado no
 * cliente contra o momento presente para continuar atualizando sem gravar. */
export async function getOpportunityStageHistory(opportunityId: string): Promise<OpportunityStageHistoryDTO[]> {
  const user = await requireOrgUser();
  const opportunity = await prisma.opportunity.findFirst({
    where: { id: opportunityId, organizationId: user.organizationId },
    select: { id: true },
  });
  if (!opportunity) return [];
  const scoped = await prisma.opportunity.findFirst({ where: { id: opportunityId, organizationId: user.organizationId }, select: { pipelineId: true } });
  if (!hasModulePermission(user, "pipeline.read") || !scoped || !(await canAccessPipeline(user, scoped.pipelineId))) return [];
  const history = await prisma.opportunityStageHistory.findMany({
    where: { opportunityId, organizationId: user.organizationId },
    include: { stage: { select: { id: true, label: true, color: true, order: true } } },
    orderBy: [{ enteredAt: "asc" }, { id: "asc" }],
  });
  return history.map((item) => ({
    id: item.id,
    stageId: item.stageId,
    stageLabel: item.stage.label,
    stageColor: item.stage.color,
    stageOrder: item.stage.order,
    enteredAt: item.enteredAt.toISOString(),
    exitedAt: item.exitedAt?.toISOString() ?? null,
  }));
}

const DEFAULT_STAGES = [
  { label: "Novo Lead", color: "#64748b", status: "OPEN" as const },
  { label: "Contato Feito", color: "#2563eb", status: "OPEN" as const },
  { label: "Proposta Enviada", color: "#7c3aed", status: "OPEN" as const },
  { label: "Negociação", color: "#ea580c", status: "OPEN" as const },
  { label: "Ganho", color: "#16a34a", status: "WON" as const },
  { label: "Perdido", color: "#dc2626", status: "LOST" as const },
];

function cleanGroup(group?: string) {
  return (group ?? "").trim().slice(0, 40) || "Geral";
}

export async function setPipelineGroup(pipelineId: string, group: string) {
  const { organizationId } = await requireAdminUser();
  await prisma.pipeline.updateMany({ where: { id: pipelineId, organizationId }, data: { groupName: cleanGroup(group) } });
  revalidatePath("/pipeline");
}

export async function createPipeline(name: string, group?: string) {
  const { organizationId } = await requireAdminUser();
  const trimmed = name.trim();
  if (!trimmed) return;

  await prisma.pipeline.create({
    data: {
      organizationId,
      name: trimmed,
      groupName: cleanGroup(group),
      stages: {
        create: DEFAULT_STAGES.map((s, i) => ({ label: s.label, color: s.color, status: s.status, order: i })),
      },
    },
  });
  revalidatePath("/pipeline");
}

export async function renamePipeline(pipelineId: string, name: string) {
  const { organizationId } = await requireAdminUser();
  const trimmed = name.trim();
  if (!trimmed) return;
  await prisma.pipeline.updateMany({ where: { id: pipelineId, organizationId }, data: { name: trimmed } });
  revalidatePath("/pipeline");
}

export async function deletePipeline(pipelineId: string) {
  const { organizationId } = await requireAdminUser();
  const count = await prisma.pipeline.count({ where: { organizationId } });
  if (count <= 1) return;
  await prisma.pipeline.deleteMany({ where: { id: pipelineId, organizationId } });
  revalidatePath("/pipeline");
}

async function assertPipelineInOrg(pipelineId: string, organizationId: string) {
  return prisma.pipeline.findFirst({ where: { id: pipelineId, organizationId } });
}

export async function addStage(pipelineId: string) {
  const { organizationId } = await requireAdminUser();
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
  const { organizationId } = await requireAdminUser();
  const trimmed = label.trim();
  if (!trimmed) return;
  const stage = await prisma.stage.findFirst({ where: { id: stageId }, include: { pipeline: true } });
  if (!stage || stage.pipeline.organizationId !== organizationId) return;
  await prisma.stage.update({ where: { id: stageId }, data: { label: trimmed } });
  revalidatePath("/pipeline");
}

export async function setStageColor(stageId: string, color: string) {
  const { organizationId } = await requireAdminUser();
  const stage = await prisma.stage.findFirst({ where: { id: stageId }, include: { pipeline: true } });
  if (!stage || stage.pipeline.organizationId !== organizationId) return;
  await prisma.stage.update({ where: { id: stageId }, data: { color } });
  revalidatePath("/pipeline");
}

export async function configureStage(stageId: string, input: { status: "OPEN" | "WON" | "LOST"; requiredFields: string[]; allowedTeams: string[]; requireLossReason: boolean; automationIds: string[] }) {
  const { organizationId } = await requireAdminUser();
  const stage = await prisma.stage.findFirst({ where: { id: stageId, pipeline: { organizationId } } });
  if (!stage) return;
  const status = ["OPEN", "WON", "LOST"].includes(input.status) ? input.status : "OPEN";
  await prisma.stage.update({ where: { id: stageId }, data: { status, requiredFields: JSON.stringify(input.requiredFields.filter(Boolean)), allowedTeams: JSON.stringify(input.allowedTeams.filter(Boolean)), requireLossReason: status === "LOST" ? true : input.requireLossReason, automationIds: JSON.stringify(input.automationIds.filter(Boolean)) } });
  revalidatePath("/pipeline");
}

export async function moveStage(pipelineId: string, stageId: string, direction: -1 | 1) {
  const { organizationId } = await requireAdminUser();
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
  const { organizationId } = await requireAdminUser();
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

async function assertStagePolicy(stageId: string, data: OpportunityInput, user: Awaited<ReturnType<typeof requireOrgUser>>) {
  await enforceStagePolicy(user.organizationId, data.pipelineId, stageId, data, user);
}

export async function createOpportunity(data: OpportunityInput) {
  const user = await requireOrgUser(); const { organizationId } = user;
  if (!hasModulePermission(user, "pipeline.write") || !(await canAccessPipeline(user, data.pipelineId, "edit"))) throw new Error("Sem permissão para alterar este pipeline.");
  const lossReason = await assertOpportunityRefs(organizationId, data);
  await assertStagePolicy(data.stageId, data, user);
  await syncTags(organizationId, data.tags, "opportunity");
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
  const user = await requireOrgUser(); const { organizationId } = user;
  const before = await prisma.opportunity.findFirst({ where: { id, organizationId } });
  if (!before) return;
  if (!hasModulePermission(user, "pipeline.write") || !(await canAccessPipeline(user, before.pipelineId, "edit")) || !(await canAccessPipeline(user, data.pipelineId, "edit"))) throw new Error("Sem permissão para alterar este pipeline.");
  const lossReason = await assertOpportunityRefs(organizationId, data);
  await assertStagePolicy(data.stageId, data, user);
  await syncTags(organizationId, data.tags, "opportunity");

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
  const opportunity = await prisma.opportunity.findFirst({ where: { id, organizationId }, select: { pipelineId: true } });
  if (!hasModulePermission(user, "pipeline.write") || !opportunity || !(await canAccessPipeline(user, opportunity.pipelineId, "edit"))) throw new Error("Sem permissão para excluir este negócio.");
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
  const user = await requireOrgUser();
  const { organizationId } = user;
  if (!hasModulePermission(user, "pipeline.write") || !hasModulePermission(user, "data.import_export") || !(await canAccessPipeline(user, defaultPipelineId, "edit"))) throw new Error("Sem permissão para importar oportunidades neste pipeline.");
  const rows = importRows(csvText, ["title"]);

  // Carrega só os contatos citados no CSV (por e-mail ou nome), em vez de todos
  // os da organização — e-mails/nomes são comparados sem diferenciar maiúsculas.
  const wantedEmails = [...new Set(rows.map((r) => (r.contact_email || "").trim().toLowerCase()).filter(Boolean))];
  const wantedPhones = [...new Set(rows.map((r) => (r.contact_phone || "").trim()).filter(Boolean))];
  const wantedNames = [...new Set(rows.map((r) => (r.contact_name || "").trim().toLowerCase()).filter(Boolean))];
  const contacts: { id: string; name: string; email: string | null; phone: string | null }[] = [];
  const CHUNK = 200;
  for (let i = 0; i < wantedEmails.length; i += CHUNK) {
    contacts.push(
      ...(await prisma.contact.findMany({
        where: { organizationId, OR: wantedEmails.slice(i, i + CHUNK).map((email) => ({ email: { equals: email, mode: "insensitive" as const } })) },
        select: { id: true, name: true, email: true, phone: true },
      }))
    );
  }
  for (let i = 0; i < wantedPhones.length; i += CHUNK) {
    contacts.push(
      ...(await prisma.contact.findMany({
        where: { organizationId, phone: { in: wantedPhones.slice(i, i + CHUNK) } },
        select: { id: true, name: true, email: true, phone: true },
      }))
    );
  }
  for (let i = 0; i < wantedNames.length; i += CHUNK) {
    contacts.push(
      ...(await prisma.contact.findMany({
        where: { organizationId, OR: wantedNames.slice(i, i + CHUNK).map((name) => ({ name: { equals: name, mode: "insensitive" as const } })) },
        select: { id: true, name: true, email: true, phone: true },
      }))
    );
  }
  const uniqueContacts = [...new Map(contacts.map((contact) => [contact.id, contact])).values()];
  const [team, pipelines, lossReasons] = await Promise.all([
    prisma.user.findMany({ where: { organizationId }, select: { id: true, name: true } }),
    prisma.pipeline.findMany({ where: { organizationId }, include: { stages: { orderBy: { order: "asc" } } } }),
    prisma.lossReason.findMany({ where: { organizationId, active: true }, select: { id: true, name: true } }),
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

    const candidates = row.contact_email?.trim()
      ? uniqueContacts.filter((contact) => contact.email?.toLowerCase() === row.contact_email.trim().toLowerCase())
      : row.contact_phone?.trim() && phoneKey(row.contact_phone).length >= 8
        ? uniqueContacts.filter((contact) => phoneKey(contact.phone ?? "") === phoneKey(row.contact_phone))
        : uniqueContacts.filter((contact) => contact.name.toLowerCase() === (row.contact_name || "").trim().toLowerCase());
    if (candidates.length !== 1) {
      skipped++;
      errors.push(`Linha ${line}: contato "${row.contact_email || row.contact_phone || row.contact_name || "?"}" ${candidates.length ? "ambíguo" : "não encontrado"}.`);
      continue;
    }
    const contact = candidates[0];

    const pipelineMatches = row.pipeline?.trim()
      ? pipelines.filter((p) => p.name.toLowerCase() === row.pipeline.trim().toLowerCase())
      : [pipelines.find((p) => p.id === defaultPipelineId) || pipelines[0]].filter((p) => !!p);
    const pipeline = pipelineMatches.length === 1 ? pipelineMatches[0] : undefined;
    if (!pipeline) {
      skipped++;
      errors.push(`Linha ${line}: pipeline "${row.pipeline || "padrão"}" ${pipelineMatches.length ? "ambíguo" : "não encontrado"}.`);
      continue;
    }
    if (!(await canAccessPipeline(user, pipeline.id, "edit"))) {
      skipped++; errors.push(`Linha ${line}: sem acesso ao pipeline "${pipeline.name}".`); continue;
    }

    const stageMatches = row.stage?.trim()
      ? pipeline.stages.filter((s) => s.label.toLowerCase() === row.stage.trim().toLowerCase())
      : [pipeline.stages[0]].filter((stage) => !!stage);
    const stage = stageMatches.length === 1 ? stageMatches[0] : undefined;
    if (!stage) {
      skipped++;
      errors.push(`Linha ${line}: etapa "${row.stage || "padrão"}" ${stageMatches.length ? "ambígua" : "não encontrada"} no pipeline "${pipeline.name}".`);
      continue;
    }

    const ownerMatches = row.owner?.trim() ? team.filter((m) => m.name.toLowerCase() === row.owner.trim().toLowerCase()) : [];
    if (row.owner?.trim() && ownerMatches.length !== 1) {
      skipped++; errors.push(`Linha ${line}: responsável "${row.owner}" ${ownerMatches.length ? "ambíguo" : "não encontrado"}.`); continue;
    }
    const owner = ownerMatches[0];
    const tags = importTags(row.tags || "");
    const value = importMoney(row.value || "");
    if (value === null) {
      skipped++; errors.push(`Linha ${line}: valor inválido.`); continue;
    }
    const expectedClose = importDate(row.expected_close || "");
    if (expectedClose === "invalid") {
      skipped++; errors.push(`Linha ${line}: data de fechamento inválida.`); continue;
    }
    const lossReason = row.loss_reason?.trim()
      ? lossReasons.find((reason) => reason.name.toLowerCase() === row.loss_reason.trim().toLowerCase())
      : undefined;
    try {
      await assertStagePolicy(stage.id, {
        title, value, tags, contactId: contact.id, pipelineId: pipeline.id, stageId: stage.id,
        ownerId: owner?.id ?? null, expectedClose: expectedClose?.toISOString() ?? null,
        lossReasonId: lossReason?.id ?? null, customFields: {},
      }, user);
    } catch (error) {
      skipped++; errors.push(`Linha ${line}: ${error instanceof Error ? error.message : "não atende às regras da etapa"}`); continue;
    }
    const duplicate = await prisma.opportunity.findFirst({
      where: { organizationId, contactId: contact.id, pipelineId: pipeline.id, title: { equals: title, mode: "insensitive" } },
      select: { id: true },
    });
    if (duplicate) {
      skipped++; errors.push(`Linha ${line}: oportunidade já existe para este contato e pipeline.`); continue;
    }
    await syncTags(organizationId, tags, "opportunity");

    try {
      await prisma.$transaction(async (tx) => {
        const newOpp = await tx.opportunity.create({
          data: {
            organizationId,
            title,
            value,
            tags: JSON.stringify(tags),
            contactId: contact.id,
            pipelineId: pipeline.id,
            stageId: stage.id,
            ownerId: owner?.id ?? null,
            expectedClose,
            lossReason: row.loss_reason?.trim() || null,
            lossReasonId: lossReason?.id ?? null,
          },
        });
        await recordStageChange(tx, { organizationId, opportunityId: newOpp.id, newStageId: stage.id });
      });
    } catch {
      skipped++; errors.push(`Linha ${line}: não foi possível criar a oportunidade.`); continue;
    }
    created++;
  }

  if (created) await audit(organizationId, { action: "opportunity.imported", entity: "Opportunity", ...actorOf(user), meta: { created, skipped } });
  revalidatePath("/pipeline");
  return { created, skipped, errors };
}

export async function moveOpportunityStage(id: string, stageId: string) {
  const user = await requireOrgUser(); const { organizationId } = user;
  const existing = await prisma.opportunity.findFirst({ where: { id, organizationId } });
  if (!existing) return;
  if (!hasModulePermission(user, "pipeline.write") || !(await canAccessPipeline(user, existing.pipelineId, "edit"))) throw new Error("Sem permissão para alterar este pipeline.");
  // A etapa de destino precisa ser do mesmo pipeline (e da mesma organização).
  const target = await prisma.stage.findFirst({
    where: { id: stageId, pipelineId: existing.pipelineId, pipeline: { organizationId } },
    select: { id: true, status: true },
  });
  if (!target) throw new Error("Etapa inválida para este pipeline.");

  await assertStagePolicy(stageId, { title: existing.title, value: existing.value, tags: [], contactId: existing.contactId, pipelineId: existing.pipelineId, stageId, ownerId: existing.ownerId, expectedClose: existing.expectedClose?.toISOString() ?? null, lossReasonId: existing.lossReasonId, customFields: existing.customFields as Record<string, unknown> }, user);

  const opp = await prisma.opportunity.update({ where: { id }, data: { stageId, ...(target.status === "LOST" ? {} : { lossReasonId: null, lossReason: null }) } });
  await recordStageChange(prisma, { organizationId, opportunityId: opp.id, newStageId: opp.stageId });
  revalidatePath("/pipeline");
  await triggerAutomations(organizationId, "STAGE_CHANGED", {
    contactId: opp.contactId,
    opportunityId: opp.id,
    pipelineId: opp.pipelineId,
    stageId: opp.stageId,
  });
}
