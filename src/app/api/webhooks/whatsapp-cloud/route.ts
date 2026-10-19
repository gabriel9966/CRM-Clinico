import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { decryptJson } from "@/lib/crypto";
import { verifyMetaSignature } from "@/lib/webhook-auth";
import { assignNextOwner } from "@/lib/assignment";
import { createInboundMessage } from "@/lib/messages";
import { triggerAutomations } from "@/lib/automation/engine";
import { logWebhook } from "@/lib/webhook-log";
import { markCampaignDelivery, markCampaignResponse } from "@/lib/campaigns";
import { ensureLiveContact } from "@/lib/inbound";
import { clientIp } from "@/lib/rate-limit";
import { sharedRateLimit } from "@/lib/shared-rate-limit";

type CloudConfig = { phoneNumberId: string; verifyToken?: string };
type CloudBody = { entry?: Array<{ changes?: Array<{ field?: string; value?: { metadata?: { phone_number_id?: string }; contacts?: Array<{ wa_id?: string; profile?: { name?: string } }>; messages?: Array<{ id?: string; from?: string; text?: { body?: string }; timestamp?: string; type?: string }>; statuses?: Array<{ id?: string; status?: string }> } }> }> };

export async function GET(req: NextRequest) {
  const mode = req.nextUrl.searchParams.get("hub.mode");
  const token = req.nextUrl.searchParams.get("hub.verify_token");
  const challenge = req.nextUrl.searchParams.get("hub.challenge");
  if (mode !== "subscribe" || !token) return NextResponse.json({ ok: false }, { status: 403 });
  const connections = await prisma.connection.findMany({ where: { provider: "WHATSAPP_CLOUD" } });
  const found = connections.some((connection) => decryptJson<CloudConfig>(connection.config).verifyToken === token);
  return found ? new NextResponse(challenge ?? "", { status: 200 }) : NextResponse.json({ ok: false }, { status: 403 });
}

export async function POST(req: NextRequest) {
  // Limite por origem, como nos demais webhooks públicos (este não tem id na URL).
  const rl = await sharedRateLimit(`webhook:whatsapp-cloud:${clientIp(req.headers)}`, { limit: 600, windowMs: 60_000 });
  if (!rl.ok) return NextResponse.json({ ok: false }, { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } });
  const raw = await req.text();
  const signature = verifyMetaSignature(raw, req.headers.get("x-hub-signature-256"), process.env.WHATSAPP_CLOUD_APP_SECRET);
  if (!signature.ok) return NextResponse.json({ ok: false, error: "invalid_signature" }, { status: 401 });
  let body: CloudBody;
  try { body = JSON.parse(raw); } catch { return NextResponse.json({ ok: false }, { status: 400 }); }
  for (const change of body.entry?.flatMap((entry) => entry.changes ?? []) ?? []) {
    const value = change.value;
    const phoneNumberId = value?.metadata?.phone_number_id;
    if (!phoneNumberId) continue;
    const connections = await prisma.connection.findMany({ where: { provider: "WHATSAPP_CLOUD" } });
    const connection = connections.find((item) => decryptJson<CloudConfig>(item.config).phoneNumberId === phoneNumberId);
    if (!connection) continue;
    for (const incoming of value?.messages ?? []) {
      const externalId = incoming.from;
      const text = incoming.text?.body;
      if (!externalId || !text) continue;
      const profile = value?.contacts?.find((contact) => contact.wa_id === externalId)?.profile?.name || `WhatsApp ${externalId.slice(-4)}`;
      let channel = await prisma.contactChannel.findUnique({ where: { connectionId_externalId: { connectionId: connection.id, externalId } }, include: { contact: true } });
      if (!channel) {
        const contact = await prisma.contact.create({ data: { organizationId: connection.organizationId, name: profile, phone: `+${externalId}`, ownerId: await assignNextOwner(connection.organizationId) } });
        channel = await prisma.contactChannel.create({ data: { connectionId: connection.id, externalId, externalName: profile, contactId: contact.id }, include: { contact: true } });
      }
      // Contato apagado (lixeira) que volta a escrever: a mensagem vai para um contato ativo.
      const contactId = await ensureLiveContact(channel, connection.organizationId, { name: profile, phone: `+${externalId}` });
      const inbound = await createInboundMessage(prisma, { organizationId: connection.organizationId, contactId, connectionId: connection.id, text, direction: "in", time: incoming.timestamp ? new Date(Number(incoming.timestamp) * 1000) : new Date(), status: "sent", externalMessageId: incoming.id });
      if (!inbound.duplicate) {
        await triggerAutomations(connection.organizationId, "MESSAGE_RECEIVED", { contactId, connectionId: connection.id, payload: { connectionId: connection.id, text, messageId: incoming.id } });
        await markCampaignResponse(connection.organizationId, contactId, connection.id);
      }
      await logWebhook({ organizationId: connection.organizationId, connectionId: connection.id, source: "whatsapp-cloud", event: change.field, statusCode: 200, detail: inbound.duplicate ? "Evento duplicado ignorado" : undefined, payload: incoming });
    }
    if ((value?.statuses?.length ?? 0) > 0) {
      for (const status of value?.statuses ?? []) {
        const rawStatus = status.status;
        const id = (status as { id?: string }).id;
        if (id && rawStatus) await markCampaignDelivery(id, rawStatus, connection.id);
      }
      await logWebhook({ organizationId: connection.organizationId, connectionId: connection.id, source: "whatsapp-cloud", event: "status", statusCode: 200, detail: value?.statuses?.map((status) => status.status).join(", "), payload: value?.statuses });
    }
  }
  return NextResponse.json({ ok: true });
}
