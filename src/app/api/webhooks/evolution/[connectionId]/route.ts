import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { triggerAutomations } from "@/lib/automation/engine";
import { assignNextOwner } from "@/lib/assignment";
import { guardWebhook } from "@/lib/webhook-auth";
import { ensureLiveContact } from "@/lib/inbound";
import { createMessage } from "@/lib/messages";
import { logWebhook } from "@/lib/webhook-log";
import { markCampaignResponse } from "@/lib/campaigns";

// Recebe eventos da instância Evolution API do usuário (configurados em
// /connections) e grava as mensagens recebidas como Message + Contact no CRM.
// A própria URL (com o id da conexão) funciona como segredo de rota — a
// Evolution API não assina os webhooks por padrão.

type EvolutionWebhookBody = {
  event?: string;
  data?: {
    key?: { remoteJid?: string; fromMe?: boolean; id?: string };
    pushName?: string;
    message?: {
      conversation?: string;
      extendedTextMessage?: { text?: string };
    };
    messageTimestamp?: number;
  };
};

function extractText(data: EvolutionWebhookBody["data"]): string | null {
  const msg = data?.message;
  if (!msg) return null;
  return msg.conversation ?? msg.extendedTextMessage?.text ?? null;
}

function phoneFromJid(remoteJid: string): string {
  const digits = remoteJid.split("@")[0];
  return `+${digits}`;
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ connectionId: string }> }) {
  const { connectionId } = await params;

  const denied = guardWebhook(req, "evolution", connectionId);
  if (denied) return denied;

  const connection = await prisma.connection.findUnique({ where: { id: connectionId } });
  if (!connection || connection.provider !== "WHATSAPP_EVOLUTION") {
    return NextResponse.json({ ok: false, error: "connection not found" }, { status: 404 });
  }

  let body: EvolutionWebhookBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 });
  }

  const event = body.event ?? "";
  if (!event.toLowerCase().includes("messages")) {
    return NextResponse.json({ ok: true, ignored: true });
  }

  const data = body.data;
  const remoteJid = data?.key?.remoteJid;
  const text = extractText(data);
  if (!remoteJid || !text) {
    return NextResponse.json({ ok: true, ignored: true });
  }

  const fromMe = Boolean(data?.key?.fromMe);
  const phone = phoneFromJid(remoteJid);
  const pushName = data?.pushName || phone;

  const organizationId = connection.organizationId;

  let channel = await prisma.contactChannel.findUnique({
    where: { connectionId_externalId: { connectionId, externalId: remoteJid } },
    include: { contact: true },
  });

  if (!channel) {
    const existingContact = await prisma.contact.findFirst({ where: { phone, organizationId } });
    const contact =
      existingContact ??
      (await prisma.contact.create({
        data: { organizationId, name: pushName, phone, ownerId: await assignNextOwner(organizationId) },
      }));

    channel = await prisma.contactChannel.create({
      data: { connectionId, externalId: remoteJid, externalName: pushName, contactId: contact.id },
      include: { contact: true },
    });
  }

  const contactId = await ensureLiveContact(channel, organizationId, { name: pushName, phone });

  const time = data?.messageTimestamp ? new Date(data.messageTimestamp * 1000) : new Date();

  await createMessage(prisma, {
    organizationId,
    contactId,
    connectionId,
    text,
    direction: fromMe ? "out" : "in",
    time,
    status: "sent",
  });

  if (!fromMe) {
    await triggerAutomations(organizationId, "MESSAGE_RECEIVED", { contactId });
    await markCampaignResponse(organizationId, contactId, connectionId);
  }

  await logWebhook({ organizationId, connectionId, source: "evolution", event, statusCode: 200, payload: body });

  return NextResponse.json({ ok: true });
}
