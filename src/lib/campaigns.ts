import "server-only";

import { prisma } from "@/lib/prisma";
import { createMessage } from "@/lib/messages";
import { decryptJson } from "@/lib/crypto";
import * as evolution from "@/lib/providers/evolution";
import * as azap from "@/lib/providers/azap";
import * as whatsappCloud from "@/lib/providers/whatsapp-cloud";
import type { ConnectionProvider } from "@prisma/client";

function brazilianNumber(phone: string | null) {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 10) return null;
  return digits.length <= 11 ? `55${digits}` : digits;
}

function render(body: string, contact: { name: string; company: string | null }) {
  return body.replace(/{{\s*(nome|name)\s*}}/gi, contact.name).replace(/{{\s*(empresa|company)\s*}}/gi, contact.company || "");
}

function templateParameters(body: string, contact: { name: string; company: string | null }) {
  return [...body.matchAll(/{{\s*(nome|name|empresa|company)\s*}}/gi)].map((match) => /nome|name/i.test(match[1]) ? contact.name : contact.company || "");
}

async function send(
  provider: ConnectionProvider,
  encryptedConfig: string,
  number: string,
  text: string,
  template: { cloudApproved: boolean; cloudTemplateName: string | null; cloudLanguage: string } | null,
  bodyParameters: string[]
) {
  if (provider === "WHATSAPP_EVOLUTION") {
    const data = await evolution.sendText(decryptJson<evolution.EvolutionConfig>(encryptedConfig), `${number}@s.whatsapp.net`, text);
    return data as { key?: { id?: string } };
  }
  if (provider === "WHATSAPP_AZAP") return azap.sendText(decryptJson<azap.AzapConfig>(encryptedConfig), number, text) as Promise<{ id?: string; messageId?: string }>;
  if (provider === "WHATSAPP_CLOUD") {
    const config = decryptJson<whatsappCloud.WhatsAppCloudConfig>(encryptedConfig);
    if (template?.cloudApproved && template.cloudTemplateName) return whatsappCloud.sendTemplate(config, number, template.cloudTemplateName, template.cloudLanguage, bodyParameters);
    return whatsappCloud.sendText(config, number, text);
  }
  throw new Error("Campanhas atualmente aceitam apenas instâncias de WhatsApp.");
}

function providerMessageId(value: unknown) {
  const result = value as { id?: string; messageId?: string; key?: { id?: string }; messages?: Array<{ id?: string }> };
  return result.messages?.[0]?.id || result.key?.id || result.messageId || result.id || null;
}

function localHour(timezone: string) {
  const part = new Intl.DateTimeFormat("en-US", { timeZone: timezone || "America/Sao_Paulo", hour: "2-digit", hourCycle: "h23" })
    .formatToParts(new Date())
    .find((part) => part.type === "hour")?.value;
  return Number(part ?? 0);
}

function isWithinSendWindow(hour: number, start: number, end: number) {
  // start 8/end 20 = 08:00 até 19:59. Janelas que cruzam meia-noite também
  // são válidas (ex.: 20h até 6h).
  if (start === end) return true;
  return start < end ? hour >= start && hour < end : hour >= start || hour < end;
}

/** Cria o snapshot de destinatários. Pode ser chamado muitas vezes sem duplicar. */
export async function prepareCampaignRecipients(campaignId: string) {
  const campaign = await prisma.campaign.findUnique({ include: { segment: true }, where: { id: campaignId } });
  if (!campaign) return 0;
  const segmentWhere = campaign.segment ? (await import("@/lib/segments")).segmentWhere(campaign.segment.filters) : {};
  const contacts = await prisma.contact.findMany({
    where: { organizationId: campaign.organizationId, deletedAt: null, marketingOptOut: false, phone: { not: null }, ...segmentWhere },
    select: { id: true },
    take: campaign.sendLimit,
    orderBy: { createdAt: "asc" },
  });
  if (!contacts.length) return 0;
  await prisma.campaignRecipient.createMany({ data: contacts.map((contact) => ({ campaignId, contactId: contact.id })), skipDuplicates: true });
  return contacts.length;
}

/** Executa um lote. O lock por destinatário (PENDING -> SENDING) evita duplicidade entre workers. */
export async function processCampaign(campaignId: string) {
  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    include: { connection: true, template: true, organization: { select: { timezone: true } } },
  });
  if (!campaign || campaign.status !== "RUNNING") return { processed: 0, done: false };
  if (campaign.connection.status !== "CONNECTED") {
    await prisma.campaign.update({ where: { id: campaignId }, data: { status: "PAUSED", pausedAt: new Date() } });
    return { processed: 0, done: false, error: "A instância remetente está desconectada; campanha pausada." };
  }

  if (!isWithinSendWindow(localHour(campaign.organization.timezone), campaign.sendWindowStart, campaign.sendWindowEnd)) {
    await prisma.campaign.update({ where: { id: campaign.id }, data: { nextRunAt: new Date(Date.now() + 60 * 60_000) } });
    return { processed: 0, done: false, waiting: "Fora da janela de envio configurada." };
  }
  if (campaign.dailyLimit > 0) {
    const sentLast24h = await prisma.campaignRecipient.count({
      where: { campaignId, sentAt: { gte: new Date(Date.now() - 24 * 60 * 60_000) }, status: { in: ["SENT", "DELIVERED", "READ", "RESPONDED"] } },
    });
    if (sentLast24h >= campaign.dailyLimit) {
      await prisma.campaign.update({ where: { id: campaign.id }, data: { nextRunAt: new Date(Date.now() + 60 * 60_000) } });
      return { processed: 0, done: false, waiting: "Limite de envio das últimas 24 horas atingido." };
    }
  }

  const recipients = await prisma.campaignRecipient.findMany({
    where: { campaignId, status: "PENDING" },
    include: { contact: { select: { id: true, name: true, company: true, phone: true, marketingOptOut: true } } },
    take: campaign.batchSize,
    orderBy: { id: "asc" },
  });
  const now = new Date();
  const duplicateSince = new Date(now.getTime() - campaign.duplicateWindowHours * 3_600_000);
  let processed = 0;

  for (const recipient of recipients) {
    const claimed = await prisma.campaignRecipient.updateMany({ where: { id: recipient.id, status: "PENDING" }, data: { status: "SENDING", attemptedAt: now } });
    if (claimed.count === 0) continue;
    processed++;
    const number = brazilianNumber(recipient.contact.phone);
    const alreadyContacted = await prisma.campaignRecipient.findFirst({
      where: {
        contactId: recipient.contactId,
        campaignId: { not: campaignId },
        sentAt: { gte: duplicateSince },
        status: { in: ["SENT", "DELIVERED", "READ", "RESPONDED"] },
        campaign: { organizationId: campaign.organizationId, connectionId: campaign.connectionId },
      },
      select: { id: true },
    });
    if (recipient.contact.marketingOptOut || !number || alreadyContacted) {
      await prisma.campaignRecipient.update({ where: { id: recipient.id }, data: { status: "SKIPPED", skippedAt: new Date(), failureReason: recipient.contact.marketingOptOut ? "Contato bloqueou comunicações." : !number ? "Contato sem telefone válido." : "Contato recebeu campanha recente nesta instância." } });
      continue;
    }
    const text = render(campaign.body, recipient.contact);
    try {
      const result = await send(campaign.connection.provider, campaign.connection.config, number, text, campaign.template, templateParameters(campaign.template?.body || "", recipient.contact));
      const externalMessageId = providerMessageId(result);
      await createMessage(prisma, { organizationId: campaign.organizationId, contactId: recipient.contactId, connectionId: campaign.connectionId, text, direction: "out", status: "sent", externalMessageId });
      await prisma.campaignRecipient.update({ where: { id: recipient.id }, data: { status: "SENT", sentAt: new Date(), providerMessageId: externalMessageId } });
    } catch (error) {
      await prisma.campaignRecipient.update({ where: { id: recipient.id }, data: { status: "FAILED", failedAt: new Date(), failureReason: error instanceof Error ? error.message.slice(0, 500) : "Falha ao enviar." } });
    }
  }

  const remaining = await prisma.campaignRecipient.count({ where: { campaignId, status: "PENDING" } });
  await prisma.campaign.update({
    where: { id: campaignId },
    data: remaining === 0 ? { status: "COMPLETED", completedAt: new Date(), nextRunAt: null } : { nextRunAt: new Date(Date.now() + campaign.intervalMinutes * 60_000) },
  });
  return { processed, done: remaining === 0 };
}

/** Varre campanhas agendadas e lotes vencidos; chamado pela instrumentação do app. */
export async function processDueCampaigns() {
  const now = new Date();
  await prisma.campaign.updateMany({ where: { status: "SCHEDULED", scheduledAt: { lte: now } }, data: { status: "RUNNING", startedAt: now, nextRunAt: now } });
  const due = await prisma.campaign.findMany({ where: { status: "RUNNING", OR: [{ nextRunAt: null }, { nextRunAt: { lte: now } }] }, select: { id: true } });
  for (const campaign of due) await processCampaign(campaign.id);
}

export async function markCampaignDelivery(providerMessageId: string, status: string) {
  const update = status === "read" ? { status: "READ" as const, readAt: new Date() } : status === "delivered" ? { status: "DELIVERED" as const, deliveredAt: new Date() } : status === "failed" ? { status: "FAILED" as const, failedAt: new Date(), failureReason: "Falha informada pelo provedor." } : null;
  if (!update) return;
  await prisma.campaignRecipient.updateMany({ where: { providerMessageId }, data: update });
  // A mesma confirmação também atualiza a mensagem apresentada no histórico
  // da conversa (sent → delivered/read/failed), e não só a métrica da campanha.
  const messageStatus = status === "read" ? "read" : status === "delivered" ? "delivered" : "failed";
  await prisma.message.updateMany({ where: { externalMessageId: providerMessageId }, data: { status: messageStatus } });
}

export async function markCampaignResponse(organizationId: string, contactId: string, connectionId: string) {
  const recipient = await prisma.campaignRecipient.findFirst({
    where: { contactId, status: { in: ["SENT", "DELIVERED", "READ"] }, campaign: { organizationId, connectionId } },
    orderBy: { sentAt: "desc" },
    select: { id: true },
  });
  if (recipient) await prisma.campaignRecipient.update({ where: { id: recipient.id }, data: { status: "RESPONDED", respondedAt: new Date() } });
}

export async function processCampaignNow(organizationId: string, campaignId: string) {
  const campaign = await prisma.campaign.findFirst({ where: { id: campaignId, organizationId }, select: { id: true } });
  if (!campaign) throw new Error("Campanha não encontrada.");
  return processCampaign(campaign.id);
}
