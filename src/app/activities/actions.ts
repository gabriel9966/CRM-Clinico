"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireOrgUser } from "@/lib/auth";

export type ActivityInput = {
  title: string;
  type: "TASK" | "CALL" | "MEETING";
  notes: string;
  dueAt: string;
  contactId: string | null;
  opportunityId: string | null;
  assigneeId: string | null;
};

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

export async function createActivity(data: ActivityInput) {
  const { organizationId } = await requireOrgUser();
  await assertActivityRefs(organizationId, data);
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
    },
  });
  revalidateAll();
}

export async function updateActivity(id: string, data: ActivityInput) {
  const { organizationId } = await requireOrgUser();
  await assertActivityRefs(organizationId, data);
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
    },
  });
  revalidateAll();
}

export async function toggleActivityDone(id: string, done: boolean) {
  const { organizationId } = await requireOrgUser();
  await prisma.activity.updateMany({ where: { id, organizationId }, data: { done } });
  revalidateAll();
}

export async function deleteActivity(id: string) {
  const { organizationId } = await requireOrgUser();
  await prisma.activity.deleteMany({ where: { id, organizationId } });
  revalidateAll();
}
