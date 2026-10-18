"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireOrgUser } from "@/lib/auth";
import { hasModulePermission } from "@/lib/access";
import {
  ensureTaskLists,
  getListCards,
  getTaskBoard,
  listWhere,
  type TaskBoardFilter,
} from "@/lib/task-board";

export type ActivityInput = {
  title: string;
  type: "TASK" | "CALL" | "MEETING";
  notes: string;
  dueAt: string;
  contactId: string | null;
  opportunityId: string | null;
  assigneeId: string | null;
  /** Coluna do quadro; omitido = não mexe (na edição) ou primeira coluna "a fazer" (na criação). */
  listId?: string | null;
};

async function requireActivityPermission(write = true) {
  const user = await requireOrgUser();
  if (!hasModulePermission(user, write ? "agenda.write" : "agenda.read")) throw new Error("Sem permissão para acessar tarefas e atividades.");
  return user;
}

function revalidateAll() {
  revalidatePath("/activities");
  revalidatePath("/contacts");
  revalidatePath("/pipeline");
}

// Os ids vêm do navegador: confere que contato, negócio e responsável são desta
// organização (senão dava para vincular tarefas a dados de outra empresa).
async function assertActivityRefs(organizationId: string, data: ActivityInput) {
  const [contact, opportunity, assignee] = await Promise.all([
    data.contactId ? prisma.contact.findFirst({ where: { id: data.contactId, organizationId }, select: { id: true } }) : true,
    data.opportunityId
      ? prisma.opportunity.findFirst({ where: { id: data.opportunityId, organizationId }, select: { id: true } })
      : true,
    data.assigneeId ? prisma.user.findFirst({ where: { id: data.assigneeId, organizationId }, select: { id: true } }) : true,
  ]);
  if (!contact) throw new Error("Contato inválido.");
  if (!opportunity) throw new Error("Oportunidade inválida.");
  if (!assignee) throw new Error("Responsável inválido.");
}

async function nextPosition(listId: string) {
  const last = await prisma.activity.aggregate({ where: { listId }, _max: { position: true } });
  return (last._max.position ?? 0) + 1;
}

async function resolveList(organizationId: string, listId: string | null | undefined) {
  const lists = await ensureTaskLists(organizationId);
  if (listId) {
    const list = lists.find((l) => l.id === listId);
    if (!list) throw new Error("Coluna inválida.");
    return { list, lists };
  }
  return { list: lists.find((l) => !l.isDone) ?? lists[0], lists };
}

export async function createActivity(data: ActivityInput) {
  const { organizationId } = await requireActivityPermission();
  await assertActivityRefs(organizationId, data);
  const { list } = await resolveList(organizationId, data.listId);
  await prisma.activity.create({
    data: {
      organizationId,
      title: data.title,
      type: data.type,
      notes: data.notes || null,
      dueAt: new Date(data.dueAt),
      contactId: data.contactId,
      opportunityId: data.opportunityId,
      assigneeId: data.assigneeId,
      listId: list.id,
      done: list.isDone,
      position: await nextPosition(list.id),
    },
  });
  revalidateAll();
}

export async function updateActivity(id: string, data: ActivityInput) {
  const { organizationId } = await requireActivityPermission();
  await assertActivityRefs(organizationId, data);
  const move =
    data.listId !== undefined && data.listId !== null
      ? await (async () => {
          const { list } = await resolveList(organizationId, data.listId);
          return { listId: list.id, done: list.isDone, position: await nextPosition(list.id) };
        })()
      : {};
  await prisma.activity.updateMany({
    where: { id, organizationId },
    data: {
      title: data.title,
      type: data.type,
      notes: data.notes || null,
      dueAt: new Date(data.dueAt),
      contactId: data.contactId,
      opportunityId: data.opportunityId,
      assigneeId: data.assigneeId,
      ...move,
    },
  });
  revalidateAll();
}

/** Marcar/desmarcar o check leva o cartão para a primeira coluna do tipo certo. */
export async function toggleActivityDone(id: string, done: boolean) {
  const { organizationId } = await requireActivityPermission();
  const lists = await ensureTaskLists(organizationId);
  const target = lists.find((l) => l.isDone === done);
  await prisma.activity.updateMany({
    where: { id, organizationId },
    data: target ? { done, listId: target.id, position: await nextPosition(target.id) } : { done },
  });
  revalidateAll();
}

export async function deleteActivity(id: string) {
  const { organizationId } = await requireActivityPermission();
  await prisma.activity.deleteMany({ where: { id, organizationId } });
  revalidateAll();
}

// ── Quadro (estilo Trello) ──────────────────────────────────────────────────

const clean = (s: string) => s.trim().slice(0, 80);

/** Criação rápida: só o título; vencimento padrão = amanhã neste horário. */
export async function createTaskCard(listId: string, title: string, assigneeId?: string | null) {
  const { organizationId } = await requireActivityPermission();
  const text = title.trim().slice(0, 200);
  if (!text) return;
  const { list } = await resolveList(organizationId, listId);
  if (assigneeId) {
    const member = await prisma.user.findFirst({ where: { id: assigneeId, organizationId }, select: { id: true } });
    if (!member) throw new Error("Responsável inválido.");
  }
  await prisma.activity.create({
    data: {
      organizationId,
      title: text,
      type: "TASK",
      dueAt: new Date(Date.now() + 86_400_000),
      listId: list.id,
      done: list.isDone,
      assigneeId: assigneeId ?? null,
      position: await nextPosition(list.id),
    },
  });
  revalidateAll();
}

/**
 * Arrastar: move o cartão para `toListId`, antes de `beforeId` (ou no fim).
 * As posições da coluna de destino são regravadas em sequência — evita empates e
 * não depende de números fracionários.
 */
export async function moveActivity(id: string, toListId: string, beforeId: string | null) {
  const { organizationId } = await requireActivityPermission();
  const { list, lists } = await resolveList(organizationId, toListId);
  const card = await prisma.activity.findFirst({ where: { id, organizationId }, select: { id: true } });
  if (!card) throw new Error("Tarefa não encontrada.");

  const siblings = await prisma.activity.findMany({
    where: { AND: [{ organizationId }, listWhere(list, lists), { id: { not: id } }] },
    orderBy: [{ position: "asc" }, { dueAt: "asc" }, { id: "asc" }],
    select: { id: true },
    take: 500,
  });
  const ids = siblings.map((s) => s.id);
  const at = beforeId ? ids.indexOf(beforeId) : -1;
  ids.splice(at >= 0 ? at : ids.length, 0, id);

  await prisma.$transaction([
    prisma.activity.updateMany({ where: { id, organizationId }, data: { listId: list.id, done: list.isDone } }),
    ...ids.map((cardId, index) =>
      prisma.activity.updateMany({ where: { id: cardId, organizationId }, data: { position: index + 1 } })
    ),
  ]);
  revalidateAll();
}

export async function createTaskList(name: string, isDone = false) {
  const { organizationId } = await requireActivityPermission();
  const text = clean(name);
  if (!text) return;
  const lists = await ensureTaskLists(organizationId);
  // Nova coluna entra antes da primeira "concluída", a menos que ela mesma seja de concluídos.
  const doneIndex = lists.findIndex((l) => l.isDone);
  const order = isDone || doneIndex < 0 ? lists.length : doneIndex;
  await prisma.$transaction([
    ...lists.filter((l) => l.order >= order).map((l) => prisma.taskList.update({ where: { id: l.id }, data: { order: l.order + 1 } })),
    prisma.taskList.create({ data: { organizationId, name: text, isDone, order } }),
  ]);
  revalidatePath("/activities");
}

export async function renameTaskList(id: string, name: string) {
  const { organizationId } = await requireActivityPermission();
  const text = clean(name);
  if (!text) return;
  await prisma.taskList.updateMany({ where: { id, organizationId }, data: { name: text } });
  revalidatePath("/activities");
}

export async function moveTaskList(id: string, dir: -1 | 1) {
  const { organizationId } = await requireActivityPermission();
  const lists = await ensureTaskLists(organizationId);
  const index = lists.findIndex((l) => l.id === id);
  const swap = lists[index + dir];
  if (index < 0 || !swap) return;
  const ordered = lists.map((l) => l.id);
  [ordered[index], ordered[index + dir]] = [ordered[index + dir], ordered[index]];
  await prisma.$transaction(ordered.map((listId, order) => prisma.taskList.updateMany({ where: { id: listId, organizationId }, data: { order } })));
  revalidatePath("/activities");
}

/** Exclui a coluna; os cartões vão para outra coluna do mesmo tipo (pendente/concluída). */
export async function deleteTaskList(id: string) {
  const { organizationId } = await requireActivityPermission();
  const lists = await ensureTaskLists(organizationId);
  const list = lists.find((l) => l.id === id);
  if (!list) return;
  const target = lists.find((l) => l.id !== id && l.isDone === list.isDone);
  if (!target) throw new Error(list.isDone ? "Mantenha ao menos uma coluna de concluídas." : "Mantenha ao menos uma coluna de pendentes.");
  const start = await nextPosition(target.id);
  const moved = await prisma.activity.findMany({
    where: { organizationId, listId: id },
    orderBy: [{ position: "asc" }, { dueAt: "asc" }],
    select: { id: true },
  });
  await prisma.$transaction([
    ...moved.map((m, i) => prisma.activity.updateMany({ where: { id: m.id, organizationId }, data: { listId: target.id, position: start + i } })),
    prisma.taskList.deleteMany({ where: { id, organizationId } }),
  ]);
  revalidateAll();
}

// Leitura para o quadro (a organização vem da sessão).
export async function fetchTaskBoard(filter: TaskBoardFilter) {
  const { organizationId } = await requireActivityPermission(false);
  return getTaskBoard(organizationId, filter);
}

export async function fetchListCards(listId: string, skip: number, filter: TaskBoardFilter) {
  const { organizationId } = await requireActivityPermission(false);
  return getListCards(organizationId, listId, { skip, filter });
}
