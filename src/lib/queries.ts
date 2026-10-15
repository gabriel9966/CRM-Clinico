import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import type {
  ActivityRowDTO,
  AppointmentRowDTO,
  ContactDTO,
  ContactRowDTO,
  ConversationRowDTO,
  DealCardDTO,
  MessageDTO,
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
  tag?: string;
  ids?: string[];
  cursor?: string;
  limit?: number;
  /** Cláusula extra montada no servidor (ex.: lista salva). Nunca vem do cliente. */
  extraWhere?: Prisma.ContactWhereInput;
};

export async function getContactsPage(organizationId: string, query: ContactListQuery = {}): Promise<Page<ContactRowDTO>> {
  const limit = clampLimit(query.limit);
  const q = query.q?.trim();
  const where: Prisma.ContactWhereInput = {
    organizationId,
    ...(query.ownerId ? { ownerId: query.ownerId } : {}),
    ...(query.tag ? { tags: { contains: JSON.stringify(query.tag) } } : {}),
    ...(query.ids ? { id: { in: query.ids } } : {}),
    ...(q ? contactSearchWhere(q) : {}),
    ...(query.extraWhere ?? {}),
  };

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
export async function searchContacts(organizationId: string, q: string, limit = 15) {
  const term = q.trim();
  const rows = await prisma.contact.findMany({
    where: { organizationId, ...(term ? contactSearchWhere(term) : {}) },
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

export type Viewer = { id: string; role: "ADMIN" | "MEMBER" };

/**
 * Detalhe do contato para o modal: negócios e as últimas mensagens. Membro
 * (MEMBER) só enxerga a conversa de contatos atribuídos a ele — mesma regra
 * da tela de Conversas.
 */
export async function getContactDetail(organizationId: string, viewer: Viewer, contactId: string) {
  const contact = await prisma.contact.findFirst({ where: { id: contactId, organizationId } });
  if (!contact) return null;

  const canSeeConversation = viewer.role === "ADMIN" || contact.ownerId === viewer.id;
  const [opps, msgs] = await Promise.all([
    prisma.opportunity.findMany({ where: { organizationId, contactId }, orderBy: { createdAt: "desc" }, take: 100 }),
    canSeeConversation
      ? prisma.message.findMany({
          where: { organizationId, contactId },
          orderBy: [{ time: "desc" }, { id: "desc" }],
          take: 100,
        })
      : Promise.resolve([]),
  ]);

  return {
    contact: toContactDTO(contact),
    opportunities: opps.map(toOpportunityDTO),
    messages: msgs.reverse().map(toMessageDTO),
    conversationHidden: !canSeeConversation,
  };
}

function toMessageDTO(m: { id: string; text: string; direction: string; time: Date; contactId: string; senderId: string | null }): MessageDTO {
  return {
    id: m.id,
    text: m.text,
    direction: m.direction as "in" | "out",
    time: m.time.toISOString(),
    contactId: m.contactId,
    senderId: m.senderId,
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

export type ConversationQuery = { restrictToOwnerId?: string; q?: string; cursor?: string; limit?: number };

/**
 * Lista de conversas: contatos com mensagem, da mais recente para a mais antiga.
 * Com `q`, busca em todos os contatos (inclusive sem conversa ainda), para dar
 * para iniciar uma conversa nova.
 */
export async function getConversationsPage(organizationId: string, query: ConversationQuery = {}): Promise<Page<ConversationRowDTO>> {
  const limit = clampLimit(query.limit, 30, 60);
  const q = query.q?.trim();
  const base: Prisma.ContactWhereInput = {
    organizationId,
    ...(query.restrictToOwnerId ? { ownerId: query.restrictToOwnerId } : {}),
  };

  let rows: Awaited<ReturnType<typeof prisma.contact.findMany>>;
  let nextCursor: string | null = null;

  if (q) {
    rows = await prisma.contact.findMany({
      where: { ...base, ...contactSearchWhere(q) },
      orderBy: [{ lastMessageAt: { sort: "desc", nulls: "last" } }, { id: "desc" }],
      take: limit,
    });
  } else {
    const cur = query.cursor ? decodeCursor(query.cursor) : null;
    const found = await prisma.contact.findMany({
      where: {
        ...base,
        lastMessageAt: { not: null },
        ...(cur ? { OR: [{ lastMessageAt: { lt: cur.t } }, { lastMessageAt: cur.t, id: { lt: cur.id } }] } : {}),
      },
      orderBy: [{ lastMessageAt: "desc" }, { id: "desc" }],
      take: limit + 1,
    });
    const hasMore = found.length > limit;
    rows = hasMore ? found.slice(0, limit) : found;
    if (hasMore) {
      const last = rows[rows.length - 1];
      nextCursor = encodeCursor(last.lastMessageAt!, last.id);
    }
  }

  return {
    items: rows.map((c) => ({
      contact: toContactDTO(c),
      lastText: c.lastMessageText,
      lastTime: c.lastMessageAt ? c.lastMessageAt.toISOString() : null,
      lastDirection: (c.lastMessageDirection as "in" | "out" | null) ?? null,
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
  const byContact: Record<string, { provider: "WHATSAPP_EVOLUTION" | "INSTAGRAM" | "EMAIL"; label: string; externalName: string | null }> = {};
  for (const ch of channels) {
    if (byContact[ch.contactId]) continue; // o mais recente por contato
    byContact[ch.contactId] = {
      provider: ch.connection.provider as "WHATSAPP_EVOLUTION" | "INSTAGRAM" | "EMAIL",
      label: ch.connection.label,
      externalName: ch.externalName,
    };
  }
  return byContact;
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
  if (viewer.role !== "ADMIN" && contact.ownerId !== viewer.id) return null;

  const limit = clampLimit(opts.limit, 40, 100);
  const rows = await prisma.message.findMany({
    where: { organizationId, contactId },
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

export async function getStageSummaries(organizationId: string, pipelineId: string): Promise<StageSummary[]> {
  const grouped = await prisma.opportunity.groupBy({
    by: ["stageId"],
    where: { organizationId, pipelineId },
    _count: { _all: true },
    _sum: { value: true },
  });
  return grouped.map((g) => ({ stageId: g.stageId, count: g._count._all, sum: g._sum.value ?? 0 }));
}

export type StageCardsQuery = { ownerId?: string; q?: string; cursor?: string; limit?: number };

export async function getStageCards(organizationId: string, stageId: string, query: StageCardsQuery = {}): Promise<Page<DealCardDTO>> {
  const limit = clampLimit(query.limit, 30, 60);
  const q = query.q?.trim();
  const rows = await prisma.opportunity.findMany({
    where: {
      organizationId,
      stageId,
      ...(query.ownerId ? { ownerId: query.ownerId } : {}),
      ...(q ? { OR: [{ title: contains(q) }, { contact: { name: contains(q) } }] } : {}),
    },
    include: { contact: { select: { name: true } } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
  });
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  return {
    items: page.map((o) => ({ ...toOpportunityDTO(o), contactName: o.contact?.name ?? null })),
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
  filters: { ownerId?: string; q?: string } = {}
): Promise<Record<string, StageColumnDTO>> {
  const stages = await prisma.stage.findMany({ where: { pipelineId, pipeline: { organizationId } }, select: { id: true } });
  if (stages.length === 0) return {};

  const q = filters.q?.trim();
  const filtered = Boolean(filters.ownerId || q);
  const [summaries, pages, filteredSummaries] = await Promise.all([
    getStageSummaries(organizationId, pipelineId),
    Promise.all(stages.map((s) => getStageCards(organizationId, s.id, filters))),
    // com filtro, os totais da coluna refletem o que está sendo filtrado
    filtered
      ? prisma.opportunity.groupBy({
          by: ["stageId"],
          where: {
            organizationId,
            pipelineId,
            ...(filters.ownerId ? { ownerId: filters.ownerId } : {}),
            ...(q ? { OR: [{ title: contains(q) }, { contact: { name: contains(q) } }] } : {}),
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

export async function searchOpportunities(organizationId: string, q: string, limit = 15) {
  const term = q.trim();
  const rows = await prisma.opportunity.findMany({
    where: {
      organizationId,
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

// ── Dashboard / equipe ──────────────────────────────────────────────────────

export type DashboardAggregates = {
  stageTotals: StageSummary[];
  monthly: { month: string; stageId: string; sum: number }[];
  ownerTotals: { ownerId: string | null; sum: number }[];
  stageSpeed: { stageId: string; avgMs: number; count: number }[];
};

export async function getDashboardAggregates(organizationId: string): Promise<DashboardAggregates> {
  const [byStage, byOwner, monthly, speed] = await Promise.all([
    prisma.opportunity.groupBy({
      by: ["stageId"],
      where: { organizationId },
      _count: { _all: true },
      _sum: { value: true },
    }),
    prisma.opportunity.groupBy({ by: ["ownerId"], where: { organizationId }, _sum: { value: true } }),
    // $queryRaw não passa pela extensão da lixeira: "deletedAt" IS NULL é manual.
    prisma.$queryRaw<{ month: string; stageId: string; sum: number | null }[]>`
      SELECT to_char("createdAt", 'YYYY-MM') AS month, "stageId", COALESCE(SUM(value), 0)::float8 AS sum
      FROM "Opportunity"
      WHERE "organizationId" = ${organizationId} AND "deletedAt" IS NULL
      GROUP BY 1, 2`,
    prisma.$queryRaw<{ stageId: string; avgMs: number; count: number }[]>`
      SELECT h."stageId",
             AVG(EXTRACT(EPOCH FROM (h."exitedAt" - h."enteredAt")) * 1000)::float8 AS "avgMs",
             COUNT(*)::int AS count
      FROM "OpportunityStageHistory" h
      JOIN "Opportunity" o ON o.id = h."opportunityId" AND o."deletedAt" IS NULL
      WHERE h."organizationId" = ${organizationId}
        AND h."exitedAt" IS NOT NULL AND h."exitedAt" >= h."enteredAt"
      GROUP BY h."stageId"`,
  ]);

  return {
    stageTotals: byStage.map((g) => ({ stageId: g.stageId, count: g._count._all, sum: g._sum.value ?? 0 })),
    monthly: monthly.map((r) => ({ month: r.month, stageId: r.stageId, sum: Number(r.sum ?? 0) })),
    ownerTotals: byOwner.map((g) => ({ ownerId: g.ownerId, sum: g._sum.value ?? 0 })),
    stageSpeed: speed.map((r) => ({ stageId: r.stageId, avgMs: Number(r.avgMs), count: Number(r.count) })),
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
