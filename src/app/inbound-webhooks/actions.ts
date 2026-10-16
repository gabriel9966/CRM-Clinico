"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireAdminUser } from "@/lib/auth";
import { webhookUrl } from "@/lib/webhook-auth";

export type InboundWebhookInput = { name: string; namePath: string; phonePath: string; emailPath: string; companyPath: string; tagsPath: string };

export async function createInboundWebhook(input: InboundWebhookInput) {
  const { organizationId } = await requireAdminUser();
  const name = input.name.trim();
  if (!name) return { error: "Dê um nome para a entrada." };
  const row = await prisma.inboundWebhook.create({ data: { organizationId, name, mapping: JSON.stringify({ name: input.namePath, phone: input.phonePath, email: input.emailPath, company: input.companyPath, tags: input.tagsPath }) } });
  revalidatePath("/connections");
  return { id: row.id, url: webhookUrl("inbound", row.id) };
}

export async function toggleInboundWebhook(id: string, enabled: boolean) {
  const { organizationId } = await requireAdminUser();
  await prisma.inboundWebhook.updateMany({ where: { id, organizationId }, data: { enabled } });
  revalidatePath("/connections");
}

export async function deleteInboundWebhook(id: string) {
  const { organizationId } = await requireAdminUser();
  await prisma.inboundWebhook.deleteMany({ where: { id, organizationId } });
  revalidatePath("/connections");
}
