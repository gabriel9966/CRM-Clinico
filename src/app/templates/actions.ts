"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireOrgUser } from "@/lib/auth";

export async function createMessageTemplate(name: string, body: string, subject?: string) {
  const { organizationId } = await requireOrgUser();
  const trimmedName = name.trim();
  const trimmedBody = body.trim();
  if (!trimmedName || !trimmedBody) return;

  await prisma.messageTemplate.create({
    data: { organizationId, name: trimmedName, body: trimmedBody, subject: subject?.trim() || null },
  });
  revalidatePath("/conversations");
}

export async function deleteMessageTemplate(id: string) {
  const { organizationId } = await requireOrgUser();
  await prisma.messageTemplate.deleteMany({ where: { id, organizationId } });
  revalidatePath("/conversations");
}
