import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { ActivityRowDTO } from "@/lib/types";

// Quadro de tarefas (estilo Trello): colunas por organização, cartões = Activity.
// Cartão sem coluna (listId nulo — criado por automação, API ou antes do quadro
// existir) aparece na primeira coluna "a fazer" se pendente, ou na primeira
// coluna "concluída" se feito.

export const BOARD_PAGE_SIZE = 30;

export type TaskCardDTO = ActivityRowDTO & { listId: string | null };

export type TaskListDTO = {
  id: string;
  name: string;
  order: number;
  isDone: boolean;
  total: number;
  cards: TaskCardDTO[];
};

export type TaskBoardFilter = {
  assigneeId?: string;
  /** Inclui tarefas em que a pessoa é responsável ou participante. */
  participantId?: string;
  search?: string;
  tag?: string;
  overdue?: boolean;
  unassigned?: boolean;
};

type ListRow = { id: string; name: string; order: number; isDone: boolean };

const DEFAULT_LISTS = [
  { name: "A fazer", isDone: false },
  { name: "Em andamento", isDone: false },
  { name: "Concluído", isDone: true },
];

/** Cria as colunas padrão na primeira vez que a organização abre o quadro. */
export async function ensureTaskLists(organizationId: string): Promise<ListRow[]> {
  const existing = await prisma.taskList.findMany({ where: { organizationId }, orderBy: [{ order: "asc" }, { createdAt: "asc" }] });
  if (existing.length > 0) return existing;
  await prisma.taskList.createMany({
    data: DEFAULT_LISTS.map((l, i) => ({ organizationId, name: l.name, isDone: l.isDone, order: i })),
  });
  return prisma.taskList.findMany({ where: { organizationId }, orderBy: [{ order: "asc" }, { createdAt: "asc" }] });
}

/** Onde o cartão está de fato: coluna explícita ou a coluna padrão do seu tipo. */
export function listWhere(list: ListRow, all: ListRow[]): Prisma.ActivityWhereInput {
  const firstTodo = all.find((l) => !l.isDone);
  const firstDone = all.find((l) => l.isDone);
  const or: Prisma.ActivityWhereInput[] = [{ listId: list.id }];
  if (firstTodo?.id === list.id) or.push({ listId: null, done: false });
  if (firstDone?.id === list.id) or.push({ listId: null, done: true });
  return { OR: or };
}

function filterWhere(organizationId: string, filter: TaskBoardFilter): Prisma.ActivityWhereInput {
  const search = filter.search?.trim().slice(0, 100);
  const clauses: Prisma.ActivityWhereInput[] = [{ organizationId }];
  if (filter.participantId) {
    clauses.push({ OR: [{ assigneeId: filter.participantId }, { collaboratorIds: { contains: JSON.stringify(filter.participantId) } }] });
  } else if (filter.assigneeId) clauses.push({ assigneeId: filter.assigneeId });
  if (filter.unassigned) clauses.push({ assigneeId: null });
  if (filter.overdue) clauses.push({ done: false, dueAt: { lt: new Date() } });
  if (filter.tag) clauses.push({ tags: { contains: JSON.stringify(filter.tag) } });
  if (search) {
    clauses.push({ OR: [
        { title: { contains: search, mode: "insensitive" as const } },
        { notes: { contains: search, mode: "insensitive" as const } },
        { contact: { name: { contains: search, mode: "insensitive" as const } } },
        { opportunity: { title: { contains: search, mode: "insensitive" as const } } },
      ] });
  }
  return { AND: clauses };
}

function stringList(raw: string): string[] {
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  } catch { return []; }
}

const CARD_ORDER: Prisma.ActivityOrderByWithRelationInput[] = [{ position: "asc" }, { dueAt: "asc" }, { id: "asc" }];

function toCard(
  a: Prisma.ActivityGetPayload<{ include: { contact: { select: { name: true } }; opportunity: { select: { title: true } } } }>,
  now: number
): TaskCardDTO {
  return {
    overdue: !a.done && a.dueAt.getTime() < now,
    id: a.id,
    type: a.type,
    title: a.title,
    notes: a.notes,
    tags: stringList(a.tags),
    collaboratorIds: stringList(a.collaboratorIds),
    dueAt: a.dueAt.toISOString(),
    done: a.done,
    createdAt: a.createdAt.toISOString(),
    contactId: a.contactId,
    opportunityId: a.opportunityId,
    assigneeId: a.assigneeId,
    contactName: a.contact?.name ?? null,
    opportunityTitle: a.opportunity?.title ?? null,
    listId: a.listId,
  };
}

export async function getListCards(
  organizationId: string,
  listId: string,
  opts: { skip?: number; filter?: TaskBoardFilter } = {}
): Promise<{ cards: TaskCardDTO[]; total: number }> {
  const lists = await ensureTaskLists(organizationId);
  const list = lists.find((l) => l.id === listId);
  if (!list) return { cards: [], total: 0 };
  return cardsFor(organizationId, list, lists, opts);
}

async function cardsFor(
  organizationId: string,
  list: ListRow,
  lists: ListRow[],
  opts: { skip?: number; filter?: TaskBoardFilter }
): Promise<{ cards: TaskCardDTO[]; total: number }> {
  const where: Prisma.ActivityWhereInput = { AND: [filterWhere(organizationId, opts.filter ?? {}), listWhere(list, lists)] };
  const [rows, total] = await Promise.all([
    prisma.activity.findMany({
      where,
      include: { contact: { select: { name: true } }, opportunity: { select: { title: true } } },
      orderBy: CARD_ORDER,
      skip: Math.max(0, opts.skip ?? 0),
      take: BOARD_PAGE_SIZE,
    }),
    prisma.activity.count({ where }),
  ]);
  const now = Date.now();
  return { cards: rows.map((a) => toCard(a, now)), total };
}

export async function getTaskBoard(organizationId: string, filter: TaskBoardFilter = {}): Promise<TaskListDTO[]> {
  const lists = await ensureTaskLists(organizationId);
  return Promise.all(
    lists.map(async (l) => {
      const { cards, total } = await cardsFor(organizationId, l, lists, { filter });
      return { id: l.id, name: l.name, order: l.order, isDone: l.isDone, total, cards };
    })
  );
}
