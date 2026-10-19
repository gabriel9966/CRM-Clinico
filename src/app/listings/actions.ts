"use server";

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireOrgUser } from "@/lib/auth";
import { allowedConnectionIds, allowedPipelineIds, canAccessConnection, canAccessPipeline, getOwnerScope, hasModulePermission } from "@/lib/access";
import { findDuplicateContacts, getGoogleConnectedUserIds } from "@/lib/data";
import { listCalendarEvents } from "@/lib/providers/google-calendar";
import { segmentWhere } from "@/lib/segments";
import {
  getActivitiesPage,
  getAppointmentsBetween,
  getAppointmentsPage,
  getChannelsFor,
  getConversationMessagesPage,
  getContactDetail,
  getContactsPage,
  getConversationsPage,
  getMessagesPage,
  getPipelineBoard,
  getStageCards,
  getStageSummaries,
  type ActivityFilter,
  type AppointmentRange,
  type ContactListQuery,
  type StageCardsQuery,
} from "@/lib/queries";
import type { ConversationChannelInfo, GoogleEventDTO } from "@/lib/types";

// Ações de leitura chamadas pelas telas para carregar mais itens, buscar e
// filtrar no servidor. Todas partem do usuário autenticado: a organização
// vem da sessão, nunca de argumento do cliente.

const sanitize = (s: string | undefined, max = 100) => (s ? s.slice(0, max) : undefined);

export async function fetchContactsPage(query: Omit<ContactListQuery, "extraWhere"> & { segmentId?: string }) {
  const user = await requireOrgUser(); const { organizationId } = user;
  if (!hasModulePermission(user, "contacts.read")) return { items: [], nextCursor: null, total: 0 };
  const { segmentId, ...rest } = query;

  // Lista salva: o filtro roda no banco, junto com a busca e a paginação.
  let extraWhere: Prisma.ContactWhereInput | undefined;
  if (segmentId) {
    const segment = await prisma.segment.findFirst({ where: { id: segmentId, organizationId, entity: "CONTACT" } });
    if (!segment) return { items: [], nextCursor: null, total: 0 };
    extraWhere = segmentWhere(segment.filters) as Prisma.ContactWhereInput;
  }

  return getContactsPage(organizationId, {
    ...rest,
    q: sanitize(rest.q),
    tag: sanitize(rest.tag, 50),
    ids: rest.ids?.slice(0, 5000),
    extraWhere,
    scope: await getOwnerScope(user),
  });
}

export async function fetchContactDetail(contactId: string) {
  const user = await requireOrgUser();
  if (!hasModulePermission(user, "contacts.read")) return null;
  const [pipelineIds, connectionIds] = await Promise.all([allowedPipelineIds(user), allowedConnectionIds(user)]);
  return getContactDetail(user.organizationId, {
    id: user.id, role: user.role,
    pipelineIds: hasModulePermission(user, "pipeline.read") ? pipelineIds : [],
    connectionIds,
    canReadMessages: hasModulePermission(user, "conversations.read"),
    canReadAgenda: hasModulePermission(user, "agenda.read"),
    manageConversations: hasModulePermission(user, "conversations.manage"),
    ownerScope: await getOwnerScope(user),
  }, contactId);
}

export async function fetchDuplicateGroups() {
  const user = await requireOrgUser(); const { organizationId } = user;
  if (!hasModulePermission(user, "contacts.read")) return [];
  return findDuplicateContacts(organizationId);
}

export async function fetchStageCards(stageId: string, query: StageCardsQuery = {}) {
  const user = await requireOrgUser(); const { organizationId } = user;
  const stage = await prisma.stage.findFirst({ where: { id: stageId, pipeline: { organizationId } }, select: { pipelineId: true } });
  if (!hasModulePermission(user, "pipeline.read") || !stage || !(await canAccessPipeline(user, stage.pipelineId))) return { items: [], nextCursor: null, total: 0 };
  return getStageCards(organizationId, stageId, { ...query, q: sanitize(query.q), scope: await getOwnerScope(user) });
}

export async function fetchStageSummaries(pipelineId: string) {
  const user = await requireOrgUser(); const { organizationId } = user;
  if (!hasModulePermission(user, "pipeline.read") || !(await canAccessPipeline(user, pipelineId))) return [];
  return getStageSummaries(organizationId, pipelineId, await getOwnerScope(user));
}

export async function fetchPipelineBoard(pipelineId: string, filters: { ownerId?: string; q?: string; tag?: string; overdue?: boolean; sort?: "newest" | "value" | "close" } = {}) {
  const user = await requireOrgUser();
  const { organizationId } = user;
  if (!hasModulePermission(user, "pipeline.read") || !(await canAccessPipeline(user, pipelineId))) return {};
  return getPipelineBoard(organizationId, pipelineId, { ownerId: filters.ownerId, q: sanitize(filters.q), tag: sanitize(filters.tag, 50), overdue: filters.overdue, sort: filters.sort, scope: await getOwnerScope(user) });
}

// Membro (MEMBER) só vê conversas dos contatos atribuídos a ele — a regra é
// aplicada aqui no servidor, não só escondendo itens na tela.
export async function fetchConversations(query: {
  q?: string; cursor?: string; ownerId?: string; team?: string; connectionId?: string; provider?: "WHATSAPP_EVOLUTION" | "WHATSAPP_AZAP" | "WHATSAPP_CLOUD" | "INSTAGRAM" | "EMAIL";
  tag?: string; stageId?: string; status?: "OPEN" | "CLOSED" | "ALL"; from?: string; to?: string;
} = {}) {
  const user = await requireOrgUser();
  if (!hasModulePermission(user, "conversations.read")) return { page: { items: [], nextCursor: null, total: 0 }, channels: {} };
  const connectionAccessIds = await allowedConnectionIds(user);
  const page = await getConversationsPage(user.organizationId, {
    q: sanitize(query.q),
    cursor: query.cursor,
    ownerId: query.ownerId,
    team: sanitize(query.team, 60),
    connectionId: query.connectionId,
    provider: query.provider,
    tag: sanitize(query.tag, 50),
    stageId: query.stageId,
    status: query.status,
    from: query.from,
    to: query.to,
    allowedConnectionIds: connectionAccessIds ?? undefined,
    ownerScope: await getOwnerScope(user),
  });
  const channels: Record<string, ConversationChannelInfo> = await getChannelsFor(
    user.organizationId,
    page.items.map((r) => r.contact.id)
  );
  return { page, channels };
}

export async function fetchThread(contactId: string, cursor?: string) {
  const user = await requireOrgUser();
  if (!hasModulePermission(user, "conversations.read")) return null;
  const connectionIds = await allowedConnectionIds(user);
  return getMessagesPage(user.organizationId, { id: user.id, role: user.role, connectionIds, ownerScope: await getOwnerScope(user) }, contactId, { cursor });
}

export async function fetchConversationThread(conversationId: string, cursor?: string) {
  const user = await requireOrgUser();
  if (!hasModulePermission(user, "conversations.read")) return null;
  const conversation = await prisma.conversation.findFirst({ where: { id: conversationId, organizationId: user.organizationId }, select: { connectionId: true } });
  if (!conversation || (conversation.connectionId && !(await canAccessConnection(user, conversation.connectionId)))) return null;
  return getConversationMessagesPage(user.organizationId, { id: user.id, role: user.role, ownerScope: await getOwnerScope(user) }, conversationId, { cursor });
}

export async function fetchActivities(filter: ActivityFilter, cursor?: string) {
  const user = await requireOrgUser(); const { organizationId } = user;
  if (!hasModulePermission(user, "agenda.read")) return { items: [], nextCursor: null, total: 0 };
  return getActivitiesPage(organizationId, { filter, cursor });
}

const MAX_CALENDAR_RANGE_MS = 43 * 86_400_000; // uma grade de mês (6 semanas) com folga

/**
 * Dados das visões de calendário (dia/semana/mês): agendamentos do CRM no
 * intervalo e os eventos com horário das agendas Google dos atendentes
 * conectados. Eventos criados pelo próprio CRM não se repetem. Da agenda dos
 * colegas só aparece "Ocupado"; título e link só para o dono.
 */
export async function fetchCalendarRange(fromIso: string, toIso: string) {
  const user = await requireOrgUser(); const { organizationId } = user;
  const empty = { appointments: [], googleEvents: [], googleErrorUserIds: [] };
  if (!hasModulePermission(user, "agenda.read")) return empty;
  const from = new Date(fromIso);
  const to = new Date(toIso);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to <= from || to.getTime() - from.getTime() > MAX_CALENDAR_RANGE_MS) {
    throw new Error("Intervalo de datas inválido.");
  }

  const [appointments, connected] = await Promise.all([
    getAppointmentsBetween(organizationId, from, to),
    getGoogleConnectedUserIds(organizationId),
  ]);
  const crmEventIds = new Set(appointments.map((a) => a.googleEventId).filter(Boolean));

  const googleEvents: GoogleEventDTO[] = [];
  const googleErrorUserIds: string[] = [];
  const ownerIds = [...connected];
  const results = await Promise.allSettled(ownerIds.map((ownerId) => listCalendarEvents(ownerId, from, to)));
  results.forEach((result, i) => {
    const ownerId = ownerIds[i];
    if (result.status === "rejected") {
      googleErrorUserIds.push(ownerId);
      return;
    }
    const mine = ownerId === user.id;
    for (const e of result.value ?? []) {
      if (crmEventIds.has(e.id)) continue;
      googleEvents.push({ ...e, ownerId, title: mine ? e.title : "Ocupado", htmlLink: mine ? e.htmlLink : null });
    }
  });

  return { appointments, googleEvents, googleErrorUserIds };
}

export async function fetchAppointments(range: AppointmentRange, cursor?: string) {
  const user = await requireOrgUser(); const { organizationId } = user;
  if (!hasModulePermission(user, "agenda.read")) return { items: [], nextCursor: null, total: 0 };
  return getAppointmentsPage(organizationId, { range, cursor });
}
