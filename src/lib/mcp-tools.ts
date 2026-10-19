import "server-only";
import { prisma } from "./prisma";
import { audit } from "./audit";
import { sendContactMessage } from "./messaging";
import { AppError } from "./errors";
import { softDeleteContacts, softDeleteOpportunity } from "./soft-delete";
import { enforceStagePolicy } from "./stage-policy";
import { recordStageChange } from "./pipeline-history";
import { syncTags } from "./crm-catalog";

function parseTags(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// Os ids que chegam pela API/MCP (etapa, responsável…) não são confiáveis:
// precisam pertencer à organização da chave, senão dava para ligar dados de
// uma empresa a registros de outra.
async function stageInPipeline(organizationId: string, pipelineId: string, stageId: string) {
  const stage = await prisma.stage.findFirst({
    where: { id: stageId, pipelineId, pipeline: { organizationId } },
    select: { id: true },
  });
  return Boolean(stage);
}

async function userInOrg(organizationId: string, userId: string) {
  const user = await prisma.user.findFirst({ where: { id: userId, organizationId }, select: { id: true } });
  return Boolean(user);
}

// Confere vários ids de uma vez; qualquer um de fora da organização vira 404.
async function assertRefs(organizationId: string, refs: { ownerId?: string; contactId?: string; opportunityId?: string }) {
  if (refs.ownerId && !(await userInOrg(organizationId, refs.ownerId))) {
    throw new AppError("responsavel_invalido", "responsável não encontrado nesta organização", 404);
  }
  if (refs.contactId) {
    const c = await prisma.contact.findFirst({ where: { id: refs.contactId, organizationId }, select: { id: true } });
    if (!c) throw new AppError("contato_invalido", "contato não encontrado nesta organização", 404);
  }
  if (refs.opportunityId) {
    const o = await prisma.opportunity.findFirst({ where: { id: refs.opportunityId, organizationId }, select: { id: true } });
    if (!o) throw new AppError("negocio_invalido", "oportunidade não encontrada nesta organização", 404);
  }
}

// Todas as funções abaixo recebem `organizationId` (resolvido a partir da
// chave de API usada na chamada, ou do contexto da automação) e filtram
// tudo por ele — é a fronteira de isolamento do multi-tenant também aqui.

export async function mcpListContacts(organizationId: string, search?: string) {
  const contacts = await prisma.contact.findMany({
    where: {
      organizationId,
      ...(search
        ? { OR: [{ name: { contains: search } }, { company: { contains: search } }, { email: { contains: search } }] }
        : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  return contacts.map((c) => ({
    id: c.id,
    name: c.name,
    company: c.company,
    email: c.email,
    phone: c.phone,
    tags: parseTags(c.tags),
    ownerId: c.ownerId,
  }));
}

export async function mcpGetContact(organizationId: string, contactId: string) {
  const contact = await prisma.contact.findFirst({
    where: { id: contactId, organizationId },
    include: {
      opportunities: { include: { stage: true, pipeline: true } },
      messages: { orderBy: { time: "desc" }, take: 20 },
    },
  });
  if (!contact) return null;
  return {
    id: contact.id,
    name: contact.name,
    company: contact.company,
    email: contact.email,
    phone: contact.phone,
    tags: parseTags(contact.tags),
    notes: contact.notes,
    opportunities: contact.opportunities.map((o) => ({
      id: o.id,
      title: o.title,
      value: o.value,
      stage: o.stage.label,
      pipeline: o.pipeline.name,
    })),
    recentMessages: contact.messages.map((m) => ({ direction: m.direction, text: m.text, time: m.time })),
  };
}

export async function mcpCreateContact(
  organizationId: string,
  input: {
    name: string;
    company?: string;
    email?: string;
    phone?: string;
    tags?: string[];
    notes?: string;
    ownerId?: string;
  }
) {
  await assertRefs(organizationId, { ownerId: input.ownerId });
  await syncTags(organizationId, input.tags ?? [], "contact");
  const contact = await prisma.contact.create({
    data: {
      organizationId,
      name: input.name,
      company: input.company,
      email: input.email,
      phone: input.phone,
      tags: JSON.stringify(input.tags ?? []),
      notes: input.notes,
      ownerId: input.ownerId,
    },
  });
  return { id: contact.id };
}

export async function mcpUpdateContact(
  organizationId: string,
  contactId: string,
  input: Partial<{
    name: string;
    company: string;
    email: string;
    phone: string;
    tags: string[];
    notes: string;
    ownerId: string;
  }>
) {
  const existing = await prisma.contact.findFirst({ where: { id: contactId, organizationId } });
  if (!existing) return { error: "contato não encontrado nesta organização" };
  await assertRefs(organizationId, { ownerId: input.ownerId });
  if (input.tags) await syncTags(organizationId, input.tags, "contact");

  const contact = await prisma.contact.update({
    where: { id: contactId },
    data: {
      name: input.name,
      company: input.company,
      email: input.email,
      phone: input.phone,
      tags: input.tags ? JSON.stringify(input.tags) : undefined,
      notes: input.notes,
      ownerId: input.ownerId,
    },
  });
  return { id: contact.id };
}

export async function mcpDeleteContact(organizationId: string, contactId: string) {
  const existing = await prisma.contact.findFirst({ where: { id: contactId, organizationId } });
  if (!existing) return { ok: false, error: "contato não encontrado nesta organização" };
  await softDeleteContacts(prisma, organizationId, [contactId]);
  await audit(organizationId, { action: "contact.deleted", entity: "Contact", entityId: contactId, actorName: "API/MCP" });
  return { ok: true };
}

export async function mcpListPipelines(organizationId: string) {
  const pipelines = await prisma.pipeline.findMany({
    where: { organizationId },
    include: { stages: { orderBy: { order: "asc" } } },
  });
  return pipelines.map((p) => ({
    id: p.id,
    name: p.name,
    stages: p.stages.map((s) => ({ id: s.id, label: s.label })),
  }));
}

export async function mcpListOpportunities(
  organizationId: string,
  filter?: { pipelineId?: string; stageId?: string; contactId?: string }
) {
  const opps = await prisma.opportunity.findMany({
    where: {
      organizationId,
      pipelineId: filter?.pipelineId,
      stageId: filter?.stageId,
      contactId: filter?.contactId,
    },
    include: { contact: true, stage: true },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  return opps.map((o) => ({
    id: o.id,
    title: o.title,
    value: o.value,
    contact: o.contact.name,
    stage: o.stage.label,
    ownerId: o.ownerId,
  }));
}

export async function mcpCreateOpportunity(
  organizationId: string,
  input: {
    title: string;
    contactId: string;
    pipelineId: string;
    stageId: string;
    value?: number;
    ownerId?: string;
  }
) {
  const contact = await prisma.contact.findFirst({ where: { id: input.contactId, organizationId } });
  if (!contact) return { error: "contato não encontrado nesta organização" };
  if (!(await stageInPipeline(organizationId, input.pipelineId, input.stageId))) {
    return { error: "pipeline/etapa não encontrados nesta organização" };
  }
  if (input.ownerId && !(await userInOrg(organizationId, input.ownerId))) {
    return { error: "responsável não encontrado nesta organização" };
  }

  await enforceStagePolicy(organizationId, input.pipelineId, input.stageId, input);
  const opp = await prisma.opportunity.create({
    data: {
      organizationId,
      title: input.title,
      contactId: input.contactId,
      pipelineId: input.pipelineId,
      stageId: input.stageId,
      value: input.value ?? 0,
      ownerId: input.ownerId,
    },
  });
  await recordStageChange(prisma, { organizationId, opportunityId: opp.id, newStageId: opp.stageId });
  return { id: opp.id };
}

export async function mcpMoveOpportunityStage(organizationId: string, opportunityId: string, stageId: string) {
  const opp = await prisma.opportunity.findFirst({ where: { id: opportunityId, organizationId } });
  if (!opp) return { ok: false, error: "oportunidade não encontrada nesta organização" };
  if (!(await stageInPipeline(organizationId, opp.pipelineId, stageId))) {
    return { ok: false, error: "etapa não encontrada neste pipeline" };
  }
  await enforceStagePolicy(organizationId, opp.pipelineId, stageId, opp);
  await prisma.$transaction(async (tx) => {
    await tx.opportunity.update({ where: { id: opportunityId }, data: { stageId } });
    await recordStageChange(tx, { organizationId, opportunityId, newStageId: stageId });
  });
  return { ok: true };
}

export async function mcpUpdateOpportunity(
  organizationId: string,
  opportunityId: string,
  input: Partial<{ title: string; stageId: string; value: number; ownerId: string }>
) {
  const opp = await prisma.opportunity.findFirst({ where: { id: opportunityId, organizationId } });
  if (!opp) return { error: "oportunidade não encontrada nesta organização" };
  if (input.stageId && !(await stageInPipeline(organizationId, opp.pipelineId, input.stageId))) {
    return { error: "etapa não encontrada neste pipeline" };
  }
  if (input.ownerId && !(await userInOrg(organizationId, input.ownerId))) {
    return { error: "responsável não encontrado nesta organização" };
  }
  if (input.stageId) await enforceStagePolicy(organizationId, opp.pipelineId, input.stageId, { ...opp, ...input });
  const updated = await prisma.opportunity.update({
    where: { id: opportunityId },
    data: { title: input.title, stageId: input.stageId, value: input.value, ownerId: input.ownerId },
  });
  if (input.stageId) await recordStageChange(prisma, { organizationId, opportunityId, newStageId: input.stageId });
  return { id: updated.id };
}

export async function mcpDeleteOpportunity(organizationId: string, opportunityId: string) {
  const opp = await prisma.opportunity.findFirst({ where: { id: opportunityId, organizationId } });
  if (!opp) return { ok: false, error: "oportunidade não encontrada nesta organização" };
  await softDeleteOpportunity(prisma, organizationId, opportunityId);
  await audit(organizationId, { action: "opportunity.deleted", entity: "Opportunity", entityId: opportunityId, actorName: "API/MCP" });
  return { ok: true };
}

export async function mcpListActivities(
  organizationId: string,
  filter?: { contactId?: string; opportunityId?: string; done?: boolean }
) {
  const activities = await prisma.activity.findMany({
    where: {
      organizationId,
      contactId: filter?.contactId,
      opportunityId: filter?.opportunityId,
      done: filter?.done,
    },
    orderBy: { dueAt: "asc" },
    take: 100,
  });
  return activities;
}

export async function mcpCreateActivity(
  organizationId: string,
  input: {
    type?: "TASK" | "CALL" | "MEETING";
    title: string;
    notes?: string;
    dueAt: string;
    contactId?: string;
    opportunityId?: string;
    assigneeId?: string;
  }
) {
  await assertRefs(organizationId, {
    contactId: input.contactId,
    opportunityId: input.opportunityId,
    ownerId: input.assigneeId,
  });
  const activity = await prisma.activity.create({
    data: {
      organizationId,
      type: input.type ?? "TASK",
      title: input.title,
      notes: input.notes,
      dueAt: new Date(input.dueAt),
      contactId: input.contactId,
      opportunityId: input.opportunityId,
      assigneeId: input.assigneeId,
    },
  });
  return { id: activity.id };
}

export async function mcpUpdateActivity(
  organizationId: string,
  activityId: string,
  input: Partial<{ title: string; notes: string; dueAt: string; done: boolean }>
) {
  const existing = await prisma.activity.findFirst({ where: { id: activityId, organizationId } });
  if (!existing) return { error: "tarefa não encontrada nesta organização" };
  const updated = await prisma.activity.update({
    where: { id: activityId },
    data: {
      title: input.title,
      notes: input.notes,
      dueAt: input.dueAt ? new Date(input.dueAt) : undefined,
      done: input.done,
    },
  });
  return { id: updated.id };
}

export async function mcpDeleteActivity(organizationId: string, activityId: string) {
  const existing = await prisma.activity.findFirst({ where: { id: activityId, organizationId } });
  if (!existing) return { ok: false, error: "tarefa não encontrada nesta organização" };
  await prisma.activity.delete({ where: { id: activityId } });
  return { ok: true };
}

export async function mcpListAppointments(organizationId: string, filter?: { contactId?: string }) {
  const appointments = await prisma.appointment.findMany({
    where: { organizationId, contactId: filter?.contactId },
    orderBy: { startAt: "asc" },
    take: 100,
  });
  return appointments;
}

export async function mcpCreateAppointment(
  organizationId: string,
  input: { title: string; notes?: string; startAt: string; endAt: string; contactId?: string }
) {
  await assertRefs(organizationId, { contactId: input.contactId });
  const appointment = await prisma.appointment.create({
    data: {
      organizationId,
      title: input.title,
      notes: input.notes,
      startAt: new Date(input.startAt),
      endAt: new Date(input.endAt),
      contactId: input.contactId,
    },
  });
  return { id: appointment.id };
}

export async function mcpListTeam(organizationId: string) {
  const team = await prisma.user.findMany({
    where: { organizationId },
    select: { id: true, name: true, email: true, role: true },
  });
  return team;
}

// Envia uma mensagem por um canal real (WhatsApp/Instagram/e-mail). Sem canal
// (ou com o canal desconectado) NÃO grava nada: devolve o motivo, em vez de
// registrar como "enviada" uma mensagem que ninguém recebeu.
export async function mcpSendMessage(organizationId: string, contactId: string, text: string, connectionId?: string) {
  const result = await sendContactMessage(organizationId, contactId, text, { connectionId });
  if (!result.ok) return { ok: false as const, code: result.code, error: result.error };
  return {
    ok: result.status === "sent",
    status: result.status,
    messageId: result.messageId,
    connectionId: result.connectionId,
    ...(result.error ? { error: result.error } : {}),
  };
}
