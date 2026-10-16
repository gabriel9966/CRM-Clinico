"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireAdminUser } from "@/lib/auth";
import { prepareCampaignRecipients, processCampaignNow } from "@/lib/campaigns";

export type CreateCampaignState = { error?: string; campaignId?: string; recipients?: number };

function positive(value: FormDataEntryValue | null, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, Math.floor(parsed))) : fallback;
}

export async function createCampaign(_prev: CreateCampaignState, form: FormData): Promise<CreateCampaignState> {
  const { organizationId } = await requireAdminUser();
  const name = String(form.get("name") || "").trim();
  const body = String(form.get("body") || "").trim();
  const connectionId = String(form.get("connectionId") || "");
  const segmentId = String(form.get("segmentId") || "").trim() || null;
  const templateId = String(form.get("templateId") || "").trim() || null;
  const scheduledRaw = String(form.get("scheduledAt") || "").trim();
  if (!name || !body || !connectionId) return { error: "Informe nome, mensagem e instância remetente." };

  const [connection, segment, template] = await Promise.all([
    prisma.connection.findFirst({ where: { id: connectionId, organizationId } }),
    segmentId ? prisma.segment.findFirst({ where: { id: segmentId, organizationId, entity: "CONTACT" } }) : null,
    templateId ? prisma.messageTemplate.findFirst({ where: { id: templateId, organizationId } }) : null,
  ]);
  if (!connection) return { error: "Instância remetente inválida." };
  if (!['WHATSAPP_EVOLUTION', 'WHATSAPP_AZAP', 'WHATSAPP_CLOUD'].includes(connection.provider)) return { error: "Campanhas em massa usam uma instância de WhatsApp." };
  if (connection.status !== "CONNECTED") return { error: "Conecte a instância antes de iniciar uma campanha." };
  if (segmentId && !segment) return { error: "Segmento inválido." };
  if (templateId && !template) return { error: "Template inválido." };
  if (connection.provider === "WHATSAPP_CLOUD" && (!template?.cloudApproved || !template.cloudTemplateName)) return { error: "Na API oficial, selecione um template já aprovado na Meta." };

  let scheduledAt: Date | null = null;
  if (scheduledRaw) {
    scheduledAt = new Date(scheduledRaw);
    if (Number.isNaN(scheduledAt.getTime()) || scheduledAt <= new Date()) return { error: "O agendamento precisa estar no futuro." };
  }
  const campaign = await prisma.campaign.create({
    data: {
      organizationId, name, body, connectionId, segmentId, templateId,
      sendLimit: positive(form.get("sendLimit"), 1000, 1, 100_000),
      batchSize: positive(form.get("batchSize"), 25, 1, 500),
      intervalMinutes: positive(form.get("intervalMinutes"), 1, 1, 1440),
      duplicateWindowHours: positive(form.get("duplicateWindowHours"), 24, 0, 24 * 365),
      status: scheduledAt ? "SCHEDULED" : "RUNNING",
      scheduledAt,
      startedAt: scheduledAt ? null : new Date(),
      nextRunAt: scheduledAt || new Date(),
    },
  });
  const recipients = await prepareCampaignRecipients(campaign.id);
  if (!scheduledAt) await processCampaignNow(organizationId, campaign.id);
  revalidatePath("/campaigns");
  return { campaignId: campaign.id, recipients };
}

export async function pauseCampaign(id: string) {
  const { organizationId } = await requireAdminUser();
  await prisma.campaign.updateMany({ where: { id, organizationId, status: { in: ["RUNNING", "SCHEDULED"] } }, data: { status: "PAUSED", pausedAt: new Date(), nextRunAt: null } });
  revalidatePath("/campaigns");
}

export async function resumeCampaign(id: string) {
  const { organizationId } = await requireAdminUser();
  const updated = await prisma.campaign.updateMany({ where: { id, organizationId, status: "PAUSED" }, data: { status: "RUNNING", pausedAt: null, nextRunAt: new Date() } });
  if (updated.count) await processCampaignNow(organizationId, id);
  revalidatePath("/campaigns");
}

export async function cancelCampaign(id: string) {
  const { organizationId } = await requireAdminUser();
  await prisma.campaign.updateMany({ where: { id, organizationId, status: { in: ["DRAFT", "SCHEDULED", "RUNNING", "PAUSED"] } }, data: { status: "CANCELLED", nextRunAt: null } });
  revalidatePath("/campaigns");
}

export async function setCampaignContactOptOut(contactId: string, value: boolean) {
  const { organizationId } = await requireAdminUser();
  await prisma.contact.updateMany({ where: { id: contactId, organizationId }, data: { marketingOptOut: value, marketingOptOutAt: value ? new Date() : null } });
  revalidatePath("/campaigns");
}

export async function createCloudApprovedTemplate(name: string, body: string, cloudTemplateName: string, cloudLanguage = "pt_BR") {
  const { organizationId } = await requireAdminUser();
  if (!name.trim() || !body.trim() || !cloudTemplateName.trim()) return { error: "Preencha todos os dados do template aprovado." };
  await prisma.messageTemplate.create({ data: { organizationId, name: name.trim(), body: body.trim(), cloudApproved: true, cloudTemplateName: cloudTemplateName.trim(), cloudLanguage: cloudLanguage.trim() || "pt_BR" } });
  revalidatePath("/campaigns");
  return { ok: true };
}
