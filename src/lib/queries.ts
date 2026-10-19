import "server-only";
import { ownerInScope, scopeWhere, type OwnerScope } from "./access-scope";
import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import type {
  ActivityRowDTO,
  AppointmentRowDTO,
  ContactDTO,
  ContactRowDTO,
  ConversationRowDTO,
  DealCardDTO,
  MessageDTO,
  ActivityDTO,
  OpportunityDTO,
  Page,
} from "./types";

// Consultas paginadas e agregadas para as telas. A regra: nenhuma tela carrega
// "todos os registros" — listas vêm por cursor (limite + nextCursor), números
// de painel vêm de agregações no banco, e seletores usam busca por digitação.
// Todas filtram por organizationId (fronteira do multi-tenant); a extensão do
// Prisma já esconde o que está na lixeira.

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

export const clampLimit = (n: number | undefined, def = DEFAULT_LIMIT, max = MAX_LIMIT) =>
  Math.min(Math.max(Math.trunc(n ?? def) || def, 1), max);

function parseTags(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((t): t is string => typeof t === "string") : [];
  } catch {
    return [];
  }
}

type ContactRow = Awaited<ReturnType<typeof prisma.contact.findFirstOrThrow>>;
type OppRow = Awaited<ReturnType<typeof prisma.opportunity.findFirstOrThrow>>;

export function toContactDTO(c: ContactRow): ContactDTO {
  return {
    id: c.id,
    name: c.name,
    company: c.company,
    email: c.email,
    phone: c.phone,
    tags: parseTags(c.tags),
    notes: c.notes,
    source: c.source,
    score: c.score,
    ownerId: c.ownerId,
    customFields: (c.customFields as Record<string, unknown>) ?? {},
    createdAt: c.createdAt.toISOString(),
  };
}

export function toOpportunityDTO(o: OppRow): OpportunityDTO {
  return {
    id: o.id,
    title: o.title,
    value: o.value,
    tags: parseTags(o.tags),
    contactId: o.contactId,
    pipelineId: o.pipelineId,
    stageId: o.stageId,
    ownerId: o.ownerId,
    expectedClose: o.expectedClose ? o.expectedClose.toISOString() : null,
    lossReason: o.lossReason,
    customFields: (o.customFields as Record<string, unknown>) ?? {},
    createdAt: o.createdAt.toISOString(),
  };
}

const contains = (v: string) => ({ contains: v, mode: "insensitive" as const });

// Texto que parece telefone: só dígitos e símbolos comuns ("(11) 99999-0000").
const LOOKS_LIKE_PHONE = /^[\d\s()+\-.]+$/;

function contactSearchWhere(q: string): Prisma.ContactWhereInput {
  const digits = q.replace(/\D/g, "");
  return {
    OR: [
      { name: contains(q) },
      { company: contains(q) },
      { email: contains(q) },
      { phone: contains(q) },
      // "(11) 99999-0000" digitado casa com "11999990000" guardado sem máscara.
      // Só quando o texto parece mesmo um telefone: buscar "Paciente 00042" não
      // pode trazer todo telefone que contém "00042".
      ...(digits.length >= 4 && LOOKS_LIKE_PHONE.test(q) ? [{ phone: { contains: digits } }] : []),
    ],
  };
}

// ── Contatos ────────────────────────────────────────────────────────────────

export type ContactListQuery = {
  q?: string;
  ownerId?: string;
  team?: string;
  tag?: string;
  ids?: string[];
  cursor?: string;
  limit?: number;
  /** Cláusula extra montada no servidor (ex.: lista salva). Nunca vem do cliente. */
  extraWhere?: Prisma.ContactWhereInput;
  /** Carteira visível (montada no servidor a partir do usuário). */
  scope?: OwnerScope;
};

export async function getContactsPage(organizationId: string, query: ContactListQuery = {}): Promise<Page<ContactRowDTO>> {
  const limit = clampLimit(query.limit);
  const q = query.q?.trim();
  let where: Prisma.ContactWhereInput = {
    organizationId,
    ...(query.ownerId === "unassigned" ? { ownerId: null } : query.ownerId ? { ownerId: query.ownerId } : {}),
    ...(query.team ? { owner: { team: query.team } } : {}),
    ...(query.tag ? { tags: { contains: JSON.stringify(query.tag) } } : {}),
    ...(query.ids ? { id: { in: query.ids } } : {}),
    ...(q ? contactSearchWhere(q) : {}),
    ...(query.extraWhere ?? {}),
  };
  if (query.scope) where = { AND: [where, scopeWhere(query.scope) as Prisma.ContactWhereInput] };

  const [rows, total] = await Promise.all([
    prisma.contact.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    }),
    // O total só é calculado na primeira página (as seguintes não mudam o número).
    query.cursor ? Promise.resolve(null) : prisma.contact.count({ where }),
  ]);

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;

  const deals = page.length
    ? await prisma.opportunity.groupBy({
        by: ["contactId"],
        where: { organizationId, contactId: { in: page.map((c) => c.id) } },
        _count: { _all: true },
      })
    : [];
  const dealsByContact = new Map(deals.map((d) => [d.contactId, d._count._all]));

  return {
    items: page.map((c) => ({ ...toContactDTO(c), dealsCount: dealsByContact.get(c.id) ?? 0 })),
    nextCursor: hasMore ? page[page.length - 1].id : null,
    total,
  };
}

/** Busca por digitação para seletores (agendamento, tarefa, novo negócio…). */
export async function searchContacts(organizationId: string, q: string, limit = 15, scope?: OwnerScope) {
  const term = q.trim();
  const rows = await prisma.contact.findMany({
    where: { organizationId, ...(term ? contactSearchWhere(term) : {}), ...(scope ? { AND: [scopeWhere(scope) as Prisma.ContactWhereInput] } : {}) },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: clampLimit(limit, 15, 30),
    select: { id: true, name: true, company: true, phone: true, email: true },
  });
  return rows;
}

export async function getContactsByIds(organizationId: string, ids: string[]): Promise<ContactDTO[]> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) return [];
  const rows = await prisma.contact.findMany({ where: { organizationId, id: { in: unique } } });
  return rows.map(toContactDTO);
}

export type Viewer = { id: string; role: "ADMIN" | "MEMBER"; pipelineIds?: string[] | null; connectionIds?: string[] | null; canReadMessages?: boolean; canReadAgenda?: boolean; manageConversations?: boolean; /** Definido = aplica a carteira (null = todos). */ ownerScope?: OwnerScope };

/**
 * Detalhe do contato para o modal: negócios e as últimas mensagens. Membro
 * (MEMBER) só enxerga a conversa de contatos atribuídos a ele — mesma regra
 * da tela de Conversas.
 */
export async function getContactDetail(organizationId: string, viewer: Viewer, contactId: string) {
  const contact = await prisma.contact.findFirst({ where: { id: contactId, organizationId } });
  if (!contact) return null;
  const scoped = viewer.ownerScope !== undefined;
  if (scoped && !ownerInScope(viewer.ownerScope ?? null, contact.ownerId)) return null;

  const canSeeConversation = viewer.canReadMessages !== false && (scoped || viewer.role === "ADMIN" || viewer.manageConversations || contact.ownerId === viewer.id);
  const [opps, msgs, activities] = await Promise.all([
    prisma.opportunity.findMany({ where: { organizationId, contactId, ...(viewer.pipelineIds ? { pipelineId: { in: viewer.pipelineIds } } : {}) }, orderBy: { createdAt: "desc" }, take: 100 }),
    canSeeConversation
      ? prisma.message.findMany({
          where: { organizationId, contactId, ...(viewer.connectionIds ? { connectionId: { in: viewer.connectionIds } } : {}), ...(scoped ? (viewer.ownerScope ? { conversation: scopeWhere(viewer.ownerScope) as Prisma.ConversationWhereInput } : {}) : viewer.role !== "ADMIN" && !viewer.manageConversations ? { conversation: { ownerId: viewer.id } } : {}) },
          orderBy: [{ time: "desc" }, { id: "desc" }],
          take: 100,
        })
      : Promise.resolve([]),
    viewer.canReadAgenda === false ? Promise.resolve([]) : prisma.activity.findMany({
      where: { organizationId, contactId },
      orderBy: [{ done: "asc" }, { dueAt: "asc" }],
      take: 8,
    }),
  ]);

  return {
    contact: toContactDTO(contact),
    opportunities: opps.map(toOpportunityDTO),
    messages: msgs.reverse().map(toMessageDTO),
    activities: activities.map(
      (activity): ActivityDTO => ({
        id: activity.id,
        type: activity.type,
        title: activity.title,
        notes: activity.notes,
        tags: parseTags(activity.tags),
        collaboratorIds: parseTags(activity.collaboratorIds),
        dueAt: activity.dueAt.toISOString(),
        done: activity.done,
        createdAt: activity.createdAt.toISOString(),
        contactId: activity.contactId,
        opportunityId: activity.opportunityId,
        assigneeId: activity.assigneeId,
      })
    ),
    conversationHidden: !canSeeConversation,
  };
}

function toMessageDTO(m: { id: string; text: string; direction: string; time: Date; contactId: string; senderId: string | null; status: string; conversationId?: string | null }): MessageDTO {
  return {
    id: m.id,
    text: m.text,
    direction: m.direction as "in" | "out",
    time: m.time.toISOString(),
    contactId: m.contactId,
    senderId: m.senderId,
    status: m.status,
    conversationId: m.conversationId ?? null,
  };
}

// ── Conversas ───────────────────────────────────────────────────────────────

const encodeCursor = (t: Date, id: string) => Buffer.from(`${t.toISOString()}|${id}`).toString("base64url");
function decodeCursor(cursor: string): { t: Date; id: string } | null {
  try {
    const [iso, id] = Buffer.from(cursor, "base64url").toString("utf8").split("|");
    const t = new Date(iso);
    return id && !Number.isNaN(t.getTime()) ? { t, id } : null;
  } catch {
    return null;
  }
}

export type ConversationQuery = {
  conversationId?: string;
  restrictToOwnerId?: string;
  /** Carteira visível (servidor). */
  ownerScope?: OwnerScope;
  q?: string;
  cursor?: string;
  limit?: number;
  ownerId?: string;
  team?: string;
  connectionId?: string;
  provider?: "WHATSAPP_EVOLUTION" | "WHATSAPP_AZAP" | "WHATSAPP_CLOUD" | "INSTAGRAM" | "EMAIL";
  tag?: string;
  stageId?: string;
  status?: "OPEN" | "CLOSED" | "ALL";
  from?: string;
  to?: string;
  allowedConnectionIds?: string[];
};

/**
 * Lista de conversas: contatos com mensagem, da mais recente para a mais antiga.
 * Com `q`, busca em todos os contatos (inclusive sem conversa ainda), para dar
 * para iniciar uma conversa nova.
 */
export async function getConversationsPage(organizationId: string, query: ConversationQuery = {}): Promise<Page<ConversationRowDTO>> {
  const limit = clampLimit(query.limit, 30, 60);
  const q = query.q?.trim();
  const from = query.from ? new Date(`${query.from}T00:00:00.000Z`) : null;
  const to = query.to ? new Date(`${query.to}T23:59:59.999Z`) : null;
  // Cada filtro é uma cláusula separada combinada com AND. Antes eram chaves de
  // um mesmo objeto: o filtro de responsável vindo do cliente SOBRESCREVIA a
  // restrição do atendente comum (ver o ownerId abaixo), e dois filtros sobre
  // `contact` (tag + busca) se apagavam. Com AND a restrição é inviolável.
  const clauses: Prisma.ConversationWhereInput[] = [{ organizationId }];
  if (query.conversationId) clauses.push({ id: query.conversationId });
  if (query.restrictToOwnerId) clauses.push({ ownerId: query.restrictToOwnerId }); // sempre vale
  if (query.ownerScope) clauses.push(scopeWhere(query.ownerScope) as Prisma.ConversationWhereInput); // idem
  if (query.ownerId === "unassigned") clauses.push({ ownerId: null });
  else if (query.ownerId) clauses.push({ ownerId: query.ownerId });
  if (query.team) clauses.push({ owner: { team: query.team } });
  if (query.connectionId) clauses.push({ connectionId: query.connectionId });
  if (query.allowedConnectionIds) clauses.push({ connectionId: { in: query.allowedConnectionIds } });
  if (query.provider) clauses.push({ connection: { provider: query.provider } });
  if (query.status && query.status !== "ALL") clauses.push({ status: query.status });
  if (query.tag) clauses.push({ contact: { tags: { contains: JSON.stringify(query.tag) } } });
  if (query.stageId) clauses.push({ contact: { opportunities: { some: { stageId: query.stageId, deletedAt: null } } } });
  if (q) clauses.push({ contact: contactSearchWhere(q) });
  if (!query.conversationId) clauses.push({ lastMessageAt: { not: null, ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } });

  let nextCursor: string | null = null;
  const cur = query.cursor ? decodeCursor(query.cursor) : null;
  if (cur) clauses.push({ OR: [{ lastMessageAt: { lt: cur.t } }, { lastMessageAt: cur.t, id: { lt: cur.id } }] });
  const found = await prisma.conversation.findMany({
    where: { AND: clauses },
    include: { contact: true, connection: true },
    orderBy: [{ lastMessageAt: "desc" }, { id: "desc" }],
    take: limit + 1,
  });
  const hasMore = found.length > limit;
  const rows = hasMore ? found.slice(0, limit) : found;
  const inboundTimes = rows.length ? await prisma.message.groupBy({
    by: ["conversationId"],
    where: { organizationId, conversationId: { in: rows.map((row) => row.id) }, direction: "in" },
    _max: { time: true },
  }) : [];
  const lastInboundByConversation = new Map(inboundTimes.map((item) => [item.conversationId, item._max.time?.toISOString() ?? null]));
  if (hasMore) {
    const last = rows[rows.length - 1];
    nextCursor = encodeCursor(last.lastMessageAt!, last.id);
  }

  return {
    items: rows.map((conversation) => ({
      id: conversation.id,
      contact: toContactDTO(conversation.contact),
      lastText: conversation.lastMessageText,
      lastTime: conversation.lastMessageAt ? conversation.lastMessageAt.toISOString() : null,
      lastDirection: (conversation.lastMessageDirection as "in" | "out" | null) ?? null,
      lastInboundAt: lastInboundByConversation.get(conversation.id) ?? null,
      status: conversation.status,
      ownerId: conversation.ownerId,
      aiPaused: !!conversation.aiPausedAt,
      channel: conversation.connection
        ? { provider: conversation.connection.provider as "WHATSAPP_EVOLUTION" | "WHATSAPP_AZAP" | "WHATSAPP_CLOUD" | "INSTAGRAM" | "EMAIL", label: conversation.connection.label, externalName: null, connectionId: conversation.connection.id }
        : null,
    })),
    nextCursor,
    total: null,
  };
}

/** Canal (WhatsApp/Instagram/e-mail) só dos contatos que estão na página. */
export async function getChannelsFor(organizationId: string, contactIds: string[]) {
  if (contactIds.length === 0) return {};
  const channels = await prisma.contactChannel.findMany({
    where: { contactId: { in: contactIds }, contact: { organizationId } },
    include: { connection: true },
    orderBy: { createdAt: "desc" },
  });
  const byContact: Record<string, { provider: "WHATSAPP_EVOLUTION" | "WHATSAPP_AZAP" | "WHATSAPP_CLOUD" | "INSTAGRAM" | "EMAIL"; label: string; externalName: string | null; connectionId: string }> = {};
  for (const ch of channels) {
    if (byContact[ch.contactId]) continue; // o mais recente por contato
    byContact[ch.contactId] = {
      provider: ch.connection.provider as "WHATSAPP_EVOLUTION" | "WHATSAPP_AZAP" | "WHATSAPP_CLOUD" | "INSTAGRAM" | "EMAIL",
      label: ch.connection.label,
      externalName: ch.externalName,
      connectionId: ch.connection.id,
    };
  }
  return byContact;
}

/** Mensagens de um atendimento específico, sempre isoladas por canal/instância. */
export async function getConversationMessagesPage(
  organizationId: string,
  viewer: Viewer,
  conversationId: string,
  opts: { cursor?: string; limit?: number } = {}
): Promise<Page<MessageDTO> | null> {
  const conversation = await prisma.conversation.findFirst({ where: { id: conversationId, organizationId }, select: { ownerId: true } });
  if (!conversation) return null;
  if (viewer.ownerScope !== undefined ? !ownerInScope(viewer.ownerScope, conversation.ownerId) : viewer.role !== "ADMIN" && conversation.ownerId !== viewer.id) return null;
  const limit = clampLimit(opts.limit, 40, 100);
  const rows = await prisma.message.findMany({
    where: { organizationId, conversationId },
    orderBy: [{ time: "desc" }, { id: "desc" }],
    take: limit + 1,
    ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
  });
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  return { items: page.reverse().map(toMessageDTO), nextCursor: hasMore ? page[0].id : null, total: null };
}

/**
 * Mensagens de um contato, da mais nova para trás: devolve `limit` mensagens em
 * ordem cronológica e, se houver mais antigas, o cursor para buscá-las.
 */
export async function getMessagesPage(
  organizationId: string,
  viewer: Viewer,
  contactId: string,
  opts: { cursor?: string; limit?: number } = {}
): Promise<Page<MessageDTO> | null> {
  const contact = await prisma.contact.findFirst({ where: { id: contactId, organizationId }, select: { ownerId: true } });
  if (!contact) return null;
  if (viewer.ownerScope !== undefined ? !ownerInScope(viewer.ownerScope, contact.ownerId) : viewer.role !== "ADMIN" && contact.ownerId !== viewer.id) return null;

  const limit = clampLimit(opts.limit, 40, 100);
  const rows = await prisma.message.findMany({
    where: { organizationId, contactId, ...(viewer.connectionIds ? { connectionId: { in: viewer.connectionIds } } : {}) },
    orderBy: [{ time: "desc" }, { id: "desc" }],
    take: limit + 1,
    ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
  });
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  return {
    items: page.reverse().map(toMessageDTO),
    nextCursor: hasMore ? page[0].id : null, // page já está em ordem cronológica: [0] é a mais antiga
    total: null,
  };
}

/** Preenche o resumo da última mensagem dos contatos que ainda não têm (idempotente). */
export async function backfillLastMessages(): Promise<number> {
  const res = await prisma.$executeRaw`
    UPDATE "Contact" c
    SET "lastMessageAt" = lm.time, "lastMessageText" = left(lm.text, 200), "lastMessageDirection" = lm.direction
    FROM (
      SELECT DISTINCT ON ("contactId") "contactId", time, text, direction
      FROM "Message"
      ORDER BY "contactId", time DESC, id DESC
    ) lm
    WHERE c.id = lm."contactId" AND c."lastMessageAt" IS NULL`;
  return Number(res);
}

// ── Pipeline ────────────────────────────────────────────────────────────────

export type StageSummary = { stageId: string; count: number; sum: number };

export async function getStageSummaries(organizationId: string, pipelineId: string, scope?: OwnerScope): Promise<StageSummary[]> {
  const grouped = await prisma.opportunity.groupBy({
    by: ["stageId"],
    where: { organizationId, pipelineId, ...(scope ? { AND: [scopeWhere(scope) as Prisma.OpportunityWhereInput] } : {}) },
    _count: { _all: true },
    _sum: { value: true },
  });
  return grouped.map((g) => ({ stageId: g.stageId, count: g._count._all, sum: g._sum.value ?? 0 }));
}

export type StageCardsQuery = { ownerId?: string; q?: string; tag?: string; overdue?: boolean; sort?: "newest" | "value" | "close"; cursor?: string; limit?: number; scope?: OwnerScope };

export async function getStageCards(organizationId: string, stageId: string, query: StageCardsQuery = {}): Promise<Page<DealCardDTO>> {
  const limit = clampLimit(query.limit, 30, 60);
  const q = query.q?.trim();
  const rows = await prisma.opportunity.findMany({
    where: {
      organizationId,
      stageId,
      ...(query.ownerId ? { ownerId: query.ownerId } : {}),
      ...(query.tag ? { tags: { contains: JSON.stringify(query.tag) } } : {}),
      ...(query.overdue ? { expectedClose: { lt: new Date() } } : {}),
      ...(q ? { OR: [{ title: contains(q) }, { contact: { name: contains(q) } }] } : {}),
      ...(query.scope ? { AND: [scopeWhere(query.scope) as Prisma.OpportunityWhereInput] } : {}),
    },
    include: { contact: { select: { name: true, company: true, channels: { include: { connection: { select: { provider: true } } }, take: 1 } } }, activities: { where: { done: false }, orderBy: { dueAt: "asc" }, take: 1, select: { title: true, dueAt: true } }, items: { select: { name: true }, take: 3 } },
    orderBy: query.sort === "value" ? [{ value: "desc" }, { id: "desc" }] : query.sort === "close" ? [{ expectedClose: "asc" }, { id: "desc" }] : [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
  });
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  return {
    items: page.map((o) => ({ ...toOpportunityDTO(o), contactName: o.contact?.name ?? null, contactCompany: o.contact?.company ?? null, nextActivity: o.activities[0] ? { title: o.activities[0].title, dueAt: o.activities[0].dueAt.toISOString() } : null, channel: o.contact?.channels[0]?.connection.provider ?? null, products: o.items.map((item) => item.name) })),
    nextCursor: hasMore ? page[page.length - 1].id : null,
    total: null,
  };
}

export type StageColumnDTO = { count: number; sum: number; cards: DealCardDTO[]; nextCursor: string | null };

/**
 * Quadro de um pipeline: para cada etapa, o total (quantidade e valor, do
 * banco) e só a primeira página de cartões. O restante vem por "carregar mais".
 */
export async function getPipelineBoard(
  organizationId: string,
  pipelineId: string,
  filters: { ownerId?: string; q?: string; tag?: string; overdue?: boolean; sort?: "newest" | "value" | "close"; scope?: OwnerScope } = {}
): Promise<Record<string, StageColumnDTO>> {
  const stages = await prisma.stage.findMany({ where: { pipelineId, pipeline: { organizationId } }, select: { id: true } });
  if (stages.length === 0) return {};

  const q = filters.q?.trim();
  const filtered = Boolean(filters.ownerId || q || filters.tag || filters.overdue);
  const [summaries, pages, filteredSummaries] = await Promise.all([
    getStageSummaries(organizationId, pipelineId, filters.scope),
    Promise.all(stages.map((s) => getStageCards(organizationId, s.id, filters))),
    // com filtro, os totais da coluna refletem o que está sendo filtrado
    filtered
      ? prisma.opportunity.groupBy({
          by: ["stageId"],
          where: {
            organizationId,
            pipelineId,
            ...(filters.ownerId ? { ownerId: filters.ownerId } : {}),
            ...(filters.tag ? { tags: { contains: JSON.stringify(filters.tag) } } : {}),
            ...(filters.overdue ? { expectedClose: { lt: new Date() } } : {}),
            ...(q ? { OR: [{ title: contains(q) }, { contact: { name: contains(q) } }] } : {}),
            ...(filters.scope ? { AND: [scopeWhere(filters.scope) as Prisma.OpportunityWhereInput] } : {}),
          },
          _count: { _all: true },
          _sum: { value: true },
        })
      : Promise.resolve(null),
  ]);

  const totals = new Map(
    (filteredSummaries
      ? filteredSummaries.map((g) => ({ stageId: g.stageId, count: g._count._all, sum: g._sum.value ?? 0 }))
      : summaries
    ).map((s) => [s.stageId, s])
  );
  const board: Record<string, StageColumnDTO> = {};
  stages.forEach((s, i) => {
    const t = totals.get(s.id);
    board[s.id] = { count: t?.count ?? 0, sum: t?.sum ?? 0, cards: pages[i].items, nextCursor: pages[i].nextCursor };
  });
  return board;
}

export async function searchOpportunities(organizationId: string, q: string, limit = 15, pipelineIds?: string[] | null, scope?: OwnerScope) {
  const term = q.trim();
  const rows = await prisma.opportunity.findMany({
    where: {
      organizationId,
      ...(scope ? { AND: [scopeWhere(scope) as Prisma.OpportunityWhereInput] } : {}),
      ...(pipelineIds ? { pipelineId: { in: pipelineIds } } : {}),
      ...(term ? { OR: [{ title: contains(term) }, { contact: { name: contains(term) } }] } : {}),
    },
    include: { contact: { select: { name: true } } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: clampLimit(limit, 15, 30),
  });
  return rows.map((o) => ({ id: o.id, title: o.title, contactName: o.contact?.name ?? null }));
}

export async function getOpportunitiesByIds(organizationId: string, ids: string[]) {
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) return [];
  const rows = await prisma.opportunity.findMany({
    where: { organizationId, id: { in: unique } },
    include: { contact: { select: { name: true } } },
  });
  return rows.map((o) => ({ id: o.id, title: o.title, contactName: o.contact?.name ?? null }));
}

// ── Tarefas e agendamentos ──────────────────────────────────────────────────

export type ActivityFilter = "pending" | "done" | "all";

export async function getActivitiesPage(
  organizationId: string,
  opts: { filter?: ActivityFilter; cursor?: string; limit?: number } = {}
): Promise<Page<ActivityRowDTO>> {
  const filter = opts.filter ?? "pending";
  const limit = clampLimit(opts.limit, 50, 100);
  const rows = await prisma.activity.findMany({
    where: { organizationId, ...(filter === "all" ? {} : { done: filter === "done" }) },
    include: { contact: { select: { name: true } }, opportunity: { select: { title: true } } },
    // pendentes: a mais urgente primeiro; concluídas: a mais recente primeiro
    orderBy: filter === "done" ? [{ dueAt: "desc" }, { id: "desc" }] : [{ dueAt: "asc" }, { id: "asc" }],
    take: limit + 1,
    ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
  });
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const now = Date.now();
  return {
    items: page.map((a) => ({
      overdue: !a.done && a.dueAt.getTime() < now,
      id: a.id,
      type: a.type,
      title: a.title,
      notes: a.notes,
      tags: parseTags(a.tags),
      collaboratorIds: parseTags(a.collaboratorIds),
      dueAt: a.dueAt.toISOString(),
      done: a.done,
      createdAt: a.createdAt.toISOString(),
      contactId: a.contactId,
      opportunityId: a.opportunityId,
      assigneeId: a.assigneeId,
      contactName: a.contact?.name ?? null,
      opportunityTitle: a.opportunity?.title ?? null,
    })),
    nextCursor: hasMore ? page[page.length - 1].id : null,
    total: null,
  };
}

export type AppointmentRange = "upcoming" | "past";

// "Próximos" começa 1 dia antes de agora (para o dia de hoje não sumir no
// fim do expediente); "Anteriores" é tudo antes disso, do mais recente ao mais antigo.
export async function getAppointmentsPage(
  organizationId: string,
  opts: { range?: AppointmentRange; cursor?: string; limit?: number; now?: Date } = {}
): Promise<Page<AppointmentRowDTO>> {
  const range = opts.range ?? "upcoming";
  const limit = clampLimit(opts.limit, 100, 200);
  const boundary = new Date((opts.now ?? new Date()).getTime() - 86_400_000);
  const rows = await prisma.appointment.findMany({
    where: { organizationId, startAt: range === "upcoming" ? { gte: boundary } : { lt: boundary } },
    include: { contact: { select: { name: true } } },
    orderBy: range === "upcoming" ? [{ startAt: "asc" }, { id: "asc" }] : [{ startAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
  });
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  return {
    items: page.map((a) => ({
      id: a.id,
      title: a.title,
      notes: a.notes,
      startAt: a.startAt.toISOString(),
      endAt: a.endAt.toISOString(),
      status: a.status,
      googleEventId: a.googleEventId,
      contactId: a.contactId,
      ownerId: a.ownerId,
      contactName: a.contact?.name ?? null,
    })),
    nextCursor: hasMore ? page[page.length - 1].id : null,
    total: null,
  };
}

/** Agendamentos que começam no intervalo [from, to), para as visões de calendário. */
export async function getAppointmentsBetween(organizationId: string, from: Date, to: Date): Promise<AppointmentRowDTO[]> {
  const rows = await prisma.appointment.findMany({
    where: { organizationId, startAt: { gte: from, lt: to } },
    include: { contact: { select: { name: true } } },
    orderBy: [{ startAt: "asc" }, { id: "asc" }],
    take: 1000,
  });
  return rows.map((a) => ({
    id: a.id,
    title: a.title,
    notes: a.notes,
    startAt: a.startAt.toISOString(),
    endAt: a.endAt.toISOString(),
    status: a.status,
    googleEventId: a.googleEventId,
    contactId: a.contactId,
    ownerId: a.ownerId,
    contactName: a.contact?.name ?? null,
  }));
}

// ── Dashboard / equipe ──────────────────────────────────────────────────────

export type DashboardAggregates = {
  stageTotals: StageSummary[];
  monthly: { month: string; stageId: string; sum: number }[];
  ownerTotals: { ownerId: string | null; sum: number }[];
  stageSpeed: { stageId: string; avgMs: number; count: number }[];
  attention: { overdueActivities: number; dueThisWeek: number; inactiveContacts: number };
  service: { inbound: number; answered: number; firstResponseMs: number | null; slaRate: number; delivered: number; read: number; failed: number };
  channels: { connectionId: string | null; label: string; provider: string; inbound: number; outbound: number; delivered: number; read: number; failed: number }[];
  campaigns: { id: string; name: string; status: string; total: number; sent: number; responded: number; failed: number }[];
};

export async function getDashboardAggregates(organizationId: string, scope: { pipelineIds?: string[] | null; connectionIds?: string[] | null; ownerId?: string; owners?: OwnerScope } = {}): Promise<DashboardAggregates> {
  const dealScope: Prisma.OpportunityWhereInput = {
    ...(scope.pipelineIds ? { pipelineId: { in: scope.pipelineIds } } : {}),
    ...(scope.owners ? { AND: [scopeWhere(scope.owners) as Prisma.OpportunityWhereInput] } : {}),
  };
  const messageScope = scope.connectionIds ? { connectionId: { in: scope.connectionIds } } : {};
  const pipelineSql = scope.pipelineIds ? Prisma.sql`AND "pipelineId" = ANY(${scope.pipelineIds}::text[])` : Prisma.empty;
  const historySql = scope.pipelineIds ? Prisma.sql`AND o."pipelineId" = ANY(${scope.pipelineIds}::text[])` : Prisma.empty;
  const connectionSql = scope.connectionIds ? Prisma.sql`AND "connectionId" = ANY(${scope.connectionIds}::text[])` : Prisma.empty;
  const now = new Date();
  const weekEnd = new Date(now);
  weekEnd.setDate(weekEnd.getDate() + 7);
  const inactiveSince = new Date(now);
  inactiveSince.setDate(inactiveSince.getDate() - 2);
  const reportSince = new Date(now.getTime() - 30 * 86_400_000);
  const [byStage, byOwner, monthly, speed, overdueActivities, dueThisWeek, inactiveContacts, responseRows, messageRows, connections, campaignRows, campaignCounts] = await Promise.all([
    prisma.opportunity.groupBy({
      by: ["stageId"],
      where: { organizationId, ...dealScope },
      _count: { _all: true },
      _sum: { value: true },
    }),
    prisma.opportunity.groupBy({ by: ["ownerId"], where: { organizationId, ...dealScope }, _sum: { value: true } }),
    // $queryRaw não passa pela extensão da lixeira: "deletedAt" IS NULL é manual.
    prisma.$queryRaw<{ month: string; stageId: string; sum: number | null }[]>`
      SELECT to_char("createdAt", 'YYYY-MM') AS month, "stageId", COALESCE(SUM(value), 0)::float8 AS sum
      FROM "Opportunity"
      WHERE "organizationId" = ${organizationId} AND "deletedAt" IS NULL
      ${pipelineSql}
      GROUP BY 1, 2`,
    prisma.$queryRaw<{ stageId: string; avgMs: number; count: number }[]>`
      SELECT h."stageId",
             AVG(EXTRACT(EPOCH FROM (h."exitedAt" - h."enteredAt")) * 1000)::float8 AS "avgMs",
             COUNT(*)::int AS count
      FROM "OpportunityStageHistory" h
      JOIN "Opportunity" o ON o.id = h."opportunityId" AND o."deletedAt" IS NULL
      WHERE h."organizationId" = ${organizationId}
        ${historySql}
        AND h."exitedAt" IS NOT NULL AND h."exitedAt" >= h."enteredAt"
      GROUP BY h."stageId"`,
    prisma.activity.count({ where: { organizationId, ...(scope.ownerId ? { assigneeId: scope.ownerId } : {}), done: false, dueAt: { lt: now } } }),
    prisma.opportunity.count({ where: { organizationId, ...dealScope, expectedClose: { gte: now, lte: weekEnd } } }),
    prisma.contact.count({ where: { organizationId, ...(scope.owners ? { AND: [scopeWhere(scope.owners) as Prisma.ContactWhereInput] } : scope.ownerId ? { ownerId: scope.ownerId } : {}), lastMessageAt: { not: null, lt: inactiveSince } } }),
    // Primeira resposta por conversa: pega a primeira entrada no período e a
    // primeira saída posterior, sem carregar todas as mensagens para a memória.
    prisma.$queryRaw<{ inbound: number; answered: number; avgMs: number | null; slaAnswered: number }[]>`
      WITH first_incoming AS (
        SELECT DISTINCT ON ("conversationId") "conversationId", "time" AS received_at
        FROM "Message"
        WHERE "organizationId" = ${organizationId}
          ${connectionSql}
          AND direction = 'in'
          AND "conversationId" IS NOT NULL
          AND "time" >= ${reportSince}
        ORDER BY "conversationId", "time" ASC
      ), responses AS (
        SELECT incoming."conversationId", incoming.received_at,
          (SELECT MIN(reply."time") FROM "Message" reply
            WHERE reply."conversationId" = incoming."conversationId"
              AND reply.direction = 'out'
              AND reply."time" >= incoming.received_at) AS replied_at
        FROM first_incoming incoming
      )
      SELECT COUNT(*)::int AS inbound,
        COUNT(replied_at)::int AS answered,
        AVG(EXTRACT(EPOCH FROM (replied_at - received_at)) * 1000)::float8 AS "avgMs",
        COUNT(*) FILTER (WHERE replied_at IS NOT NULL AND replied_at - received_at <= INTERVAL '15 minutes')::int AS "slaAnswered"
      FROM responses`,
    prisma.message.groupBy({
      by: ["connectionId", "direction", "status"],
      where: { organizationId, ...messageScope, time: { gte: reportSince } },
      _count: { _all: true },
    }),
    prisma.connection.findMany({ where: { organizationId, ...(scope.connectionIds ? { id: { in: scope.connectionIds } } : {}) }, select: { id: true, label: true, provider: true } }),
    prisma.campaign.findMany({
      where: { organizationId, ...messageScope },
      select: { id: true, name: true, status: true },
      orderBy: { createdAt: "desc" },
      take: 6,
    }),
    prisma.campaignRecipient.groupBy({
      by: ["campaignId", "status"],
      where: { campaign: { organizationId, ...messageScope } },
      _count: { _all: true },
    }),
  ]);

  const response = responseRows[0] ?? { inbound: 0, answered: 0, avgMs: null, slaAnswered: 0 };
  const connectionInfo = new Map(connections.map((connection) => [connection.id, connection]));
  const channels = new Map<string, { connectionId: string | null; label: string; provider: string; inbound: number; outbound: number; delivered: number; read: number; failed: number }>();
  for (const row of messageRows) {
    const key = row.connectionId ?? "legacy";
    const info = row.connectionId ? connectionInfo.get(row.connectionId) : null;
    const channel = channels.get(key) ?? { connectionId: row.connectionId, label: info?.label ?? "Sem instância", provider: info?.provider ?? "LEGACY", inbound: 0, outbound: 0, delivered: 0, read: 0, failed: 0 };
    if (row.direction === "in") channel.inbound += row._count._all;
    else channel.outbound += row._count._all;
    if (row.status === "delivered") channel.delivered += row._count._all;
    if (row.status === "read") channel.read += row._count._all;
    if (row.status === "failed") channel.failed += row._count._all;
    channels.set(key, channel);
  }
  const campaignSummary = campaignRows.map((campaign) => {
    const count = (status: string) => campaignCounts.filter((row) => row.campaignId === campaign.id && row.status === status).reduce((sum, row) => sum + row._count._all, 0);
    return { id: campaign.id, name: campaign.name, status: campaign.status, total: campaignCounts.filter((row) => row.campaignId === campaign.id).reduce((sum, row) => sum + row._count._all, 0), sent: count("SENT") + count("DELIVERED") + count("READ") + count("RESPONDED"), responded: count("RESPONDED"), failed: count("FAILED") };
  });

  return {
    stageTotals: byStage.map((g) => ({ stageId: g.stageId, count: g._count._all, sum: g._sum.value ?? 0 })),
    monthly: monthly.map((r) => ({ month: r.month, stageId: r.stageId, sum: Number(r.sum ?? 0) })),
    ownerTotals: byOwner.map((g) => ({ ownerId: g.ownerId, sum: g._sum.value ?? 0 })),
    stageSpeed: speed.map((r) => ({ stageId: r.stageId, avgMs: Number(r.avgMs), count: Number(r.count) })),
    attention: { overdueActivities, dueThisWeek, inactiveContacts },
    service: { inbound: Number(response.inbound), answered: Number(response.answered), firstResponseMs: response.avgMs === null ? null : Number(response.avgMs), slaRate: Number(response.inbound) ? (Number(response.slaAnswered) / Number(response.inbound)) * 100 : 0, delivered: [...channels.values()].reduce((sum, channel) => sum + channel.delivered, 0), read: [...channels.values()].reduce((sum, channel) => sum + channel.read, 0), failed: [...channels.values()].reduce((sum, channel) => sum + channel.failed, 0) },
    channels: [...channels.values()].sort((a, b) => b.inbound + b.outbound - (a.inbound + a.outbound)),
    campaigns: campaignSummary,
  };
}

export type OwnerStats = {
  contactsByOwner: Record<string, number>;
  dealsByOwnerStage: { ownerId: string | null; stageId: string; count: number; sum: number }[];
};

export async function getOwnerStats(organizationId: string): Promise<OwnerStats> {
  const [contacts, deals] = await Promise.all([
    prisma.contact.groupBy({ by: ["ownerId"], where: { organizationId }, _count: { _all: true } }),
    prisma.opportunity.groupBy({
      by: ["ownerId", "stageId"],
      where: { organizationId },
      _count: { _all: true },
      _sum: { value: true },
    }),
  ]);
  const contactsByOwner: Record<string, number> = {};
  for (const c of contacts) if (c.ownerId) contactsByOwner[c.ownerId] = c._count._all;
  return {
    contactsByOwner,
    dealsByOwnerStage: deals.map((d) => ({ ownerId: d.ownerId, stageId: d.stageId, count: d._count._all, sum: d._sum.value ?? 0 })),
  };
}
