"use server";

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireOrgUser } from "@/lib/auth";
import { findDuplicateContacts } from "@/lib/data";
import { segmentWhere } from "@/lib/segments";
import {
  getActivitiesPage,
  getAppointmentsPage,
  getChannelsFor,
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
  const { organizationId } = await requireOrgUser();
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
  return getContactDetail(user.organizationId, { id: user.id, role: user.role }, contactId);
}

export async function fetchDuplicateGroups() {
  const { organizationId } = await requireOrgUser();
  return findDuplicateContacts(organizationId);
}

export async function fetchStageCards(stageId: string, query: StageCardsQuery = {}) {
  const { organizationId } = await requireOrgUser();
  return getStageCards(organizationId, stageId, { ...query, q: sanitize(query.q) });
}

export async function fetchStageSummaries(pipelineId: string) {
  const { organizationId } = await requireOrgUser();
  return getStageSummaries(organizationId, pipelineId);
}

export async function fetchPipelineBoard(pipelineId: string, filters: { ownerId?: string; q?: string } = {}) {
  const { organizationId } = await requireOrgUser();
  return getPipelineBoard(organizationId, pipelineId, { ownerId: filters.ownerId, q: sanitize(filters.q) });
}

// Membro (MEMBER) só vê conversas dos contatos atribuídos a ele — a regra é
// aplicada aqui no servidor, não só escondendo itens na tela.
export async function fetchConversations(query: { q?: string; cursor?: string } = {}) {
  const user = await requireOrgUser();
  const page = await getConversationsPage(user.organizationId, {
    q: sanitize(query.q),
    cursor: query.cursor,
    restrictToOwnerId: user.role === "ADMIN" ? undefined : user.id,
  });
  const channels: Record<string, ConversationChannelInfo> = await getChannelsFor(
    user.organizationId,
    page.items.map((r) => r.contact.id)
  );
  return { page, channels };
}

export async function fetchThread(contactId: string, cursor?: string) {
  const user = await requireOrgUser();
  return getMessagesPage(user.organizationId, { id: user.id, role: user.role }, contactId, { cursor });
}

export async function fetchActivities(filter: ActivityFilter, cursor?: string) {
  const { organizationId } = await requireOrgUser();
  return getActivitiesPage(organizationId, { filter, cursor });
}

export async function fetchAppointments(range: AppointmentRange, cursor?: string) {
  const { organizationId } = await requireOrgUser();
  return getAppointmentsPage(organizationId, { range, cursor });
}
