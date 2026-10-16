import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { guardWebhook } from "@/lib/webhook-auth";
import { assignNextOwner } from "@/lib/assignment";
import { createMessage } from "@/lib/messages";
import { triggerAutomations } from "@/lib/automation/engine";
import { logWebhook } from "@/lib/webhook-log";
import { markCampaignResponse } from "@/lib/campaigns";
import { ensureLiveContact } from "@/lib/inbound";

// Normaliza os formatos mais comuns de gateways compatíveis com AZAP. Caso a
// conta entregue outro JSON, ele continua registrado no log para configurar o
// adaptador sem perder eventos.
const pick = (body: Record<string, unknown>, names: string[]) => names.map((name) => body[name]).find((value) => typeof value === "string") as string | undefined;

export async function POST(req: NextRequest, { params }: { params: Promise<{ connectionId: string }> }) {
  const { connectionId } = await params;
  const denied = guardWebhook(req, "azap", connectionId);
  if (denied) return denied;
  const connection = await prisma.connection.findUnique({ where: { id: connectionId } });
  if (!connection || connection.provider !== "WHATSAPP_AZAP") return NextResponse.json({ ok: false }, { status: 404 });
  const body = await req.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ ok: false }, { status: 400 });
  const phone = pick(body, ["phone", "from", "number", "remoteJid"]);
  const text = pick(body, ["text", "message", "body", "content"]);
  const event = pick(body, ["event", "type", "action"]);
  if (!phone || !text) {
    await logWebhook({ organizationId: connection.organizationId, connectionId, source: "azap", event, statusCode: 202, detail: "Evento sem texto ou telefone", payload: body });
    return NextResponse.json({ ok: true, ignored: true });
  }
  const externalId = phone.replace(/^\+/, "").replace(/@.+$/, "");
  let channel = await prisma.contactChannel.findUnique({ where: { connectionId_externalId: { connectionId, externalId } }, include: { contact: true } });
  if (!channel) {
    const contact = await prisma.contact.create({ data: { organizationId: connection.organizationId, name: `WhatsApp ${externalId.slice(-4)}`, phone: `+${externalId}`, ownerId: await assignNextOwner(connection.organizationId) } });
    channel = await prisma.contactChannel.create({ data: { connectionId, externalId, externalName: contact.name, contactId: contact.id }, include: { contact: true } });
  }
  // Contato apagado (lixeira) que volta a escrever: a mensagem vai para um contato ativo.
  const contactId = await ensureLiveContact(channel, connection.organizationId, { name: `WhatsApp ${externalId.slice(-4)}`, phone: `+${externalId}` });
  await createMessage(prisma, { organizationId: connection.organizationId, contactId, connectionId, text, direction: "in", status: "sent" });
  await triggerAutomations(connection.organizationId, "MESSAGE_RECEIVED", { contactId });
  await markCampaignResponse(connection.organizationId, contactId, connectionId);
  await logWebhook({ organizationId: connection.organizationId, connectionId, source: "azap", event, statusCode: 200, payload: body });
  return NextResponse.json({ ok: true });
}
