"use server";

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireOrgUser } from "@/lib/auth";
import { allowedConnectionIds, canAccessConnection, canAccessPipeline, hasModulePermission } from "@/lib/access";
import { findDuplicateContacts } from "@/lib/data";
import { segmentWhere } from "@/lib/segments";
import {
  getActivitiesPage,
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
import type { ConversationChannelInfo } from "@/lib/types";

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
  });
}

export async function fetchContactDetail(contactId: string) {
  const user = await requireOrgUser();
  if (!hasModulePermission(user, "contacts.read")) return null;
  return getContactDetail(user.organizationId, { id: user.id, role: user.role }, contactId);
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
  return getStageCards(organizationId, stageId, { ...query, q: sanitize(query.q) });
}

export async function fetchStageSummaries(pipelineId: string) {
  const user = await requireOrgUser(); const { organizationId } = user;
  if (!hasModulePermission(user, "pipeline.read") || !(await canAccessPipeline(user, pipelineId))) return [];
  return getStageSummaries(organizationId, pipelineId);
}

export async function fetchPipelineBoard(pipelineId: string, filters: { ownerId?: string; q?: string; tag?: string; overdue?: boolean; sort?: "newest" | "value" | "close" } = {}) {
  const user = await requireOrgUser();
  const { organizationId } = user;
  if (!hasModulePermission(user, "pipeline.read") || !(await canAccessPipeline(user, pipelineId))) return {};
  return getPipelineBoard(organizationId, pipelineId, { ownerId: filters.ownerId, q: sanitize(filters.q), tag: sanitize(filters.tag, 50), overdue: filters.overdue, sort: filters.sort });
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
    restrictToOwnerId: hasModulePermission(user, "conversations.manage") ? undefined : user.id,
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
  return getMessagesPage(user.organizationId, { id: user.id, role: hasModulePermission(user, "conversations.manage") ? "ADMIN" : user.role }, contactId, { cursor });
}

export async function fetchConversationThread(conversationId: string, cursor?: string) {
  const user = await requireOrgUser();
  if (!hasModulePermission(user, "conversations.read")) return null;
  const conversation = await prisma.conversation.findFirst({ where: { id: conversationId, organizationId: user.organizationId }, select: { connectionId: true } });
  if (!conversation || (conversation.connectionId && !(await canAccessConnection(user, conversation.connectionId)))) return null;
  return getConversationMessagesPage(user.organizationId, { id: user.id, role: hasModulePermission(user, "conversations.manage") ? "ADMIN" : user.role }, conversationId, { cursor });
}

export async function fetchActivities(filter: ActivityFilter, cursor?: string) {
  const user = await requireOrgUser(); const { organizationId } = user;
  if (!hasModulePermission(user, "agenda.read")) return { items: [], nextCursor: null, total: 0 };
  return getActivitiesPage(organizationId, { filter, cursor });
}

export async function fetchAppointments(range: AppointmentRange, cursor?: string) {
  const user = await requireOrgUser(); const { organizationId } = user;
  if (!hasModulePermission(user, "agenda.read")) return { items: [], nextCursor: null, total: 0 };
  return getAppointmentsPage(organizationId, { range, cursor });
}
