import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { triggerAutomations } from "@/lib/automation/engine";
import { guardWebhook } from "@/lib/webhook-auth";
import { resolveInboundContact } from "@/lib/inbound";
import { createInboundMessage } from "@/lib/messages";
import { logWebhook } from "@/lib/webhook-log";
import { markCampaignResponse, markCampaignDelivery } from "@/lib/campaigns";
import { parseEvolutionEvent } from "@/lib/providers/evolution-events";

// Recebe eventos da instância Evolution API do usuário (configurados em
// /connections) e grava as mensagens recebidas como Message + Contact no CRM.
// A Evolution API não assina os webhooks: a URL leva o token HMAC da conexão.

function phoneFromJid(remoteJid: string): string {
  const digits = remoteJid.split("@")[0];
  return `+${digits}`;
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ connectionId: string }> }) {
  const { connectionId } = await params;

  const denied = await guardWebhook(req, "evolution", connectionId);
  if (denied) return denied;

  const connection = await prisma.connection.findUnique({ where: { id: connectionId } });
  if (!connection || connection.provider !== "WHATSAPP_EVOLUTION") {
    return NextResponse.json({ ok: false, error: "connection not found" }, { status: 404 });
  }

  let body: { event?: string; Event?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 });
  }

  const event = body.event ?? body.Event ?? "";
  const organizationId = connection.organizationId;
  const normalized = parseEvolutionEvent(body);
  if (normalized.kind === "connection") {
    await prisma.connection.update({ where: { id: connectionId }, data: { status: normalized.status, lastError: null } });
    return NextResponse.json({ ok: true });
  }
  if (normalized.kind === "receipt") {
    if (normalized.status) for (const id of normalized.ids) await markCampaignDelivery(id, normalized.status, connectionId);
    return NextResponse.json({ ok: true });
  }
  if (normalized.kind !== "message") {
    // Mensagem descartada fica no log da conexão: sem isso, "não chegou nada"
    // era impossível de diagnosticar. Outros eventos (presença etc.) não.
    if ("reason" in normalized && normalized.reason) {
      await logWebhook({ organizationId, connectionId, source: "evolution", event, statusCode: 202, detail: `Ignorada: ${normalized.reason}`, payload: body });
    }
    return NextResponse.json({ ok: true, ignored: true });
  }

  const { jid: remoteJid, text, fromMe } = normalized;
  const phone = phoneFromJid(remoteJid);
  const pushName = (!fromMe && normalized.name) || phone;

  const { contactId, created } = await resolveInboundContact({
    organizationId,
    connectionId,
    externalId: remoteJid,
    who: { name: pushName, phone },
  });

  const inbound = await createInboundMessage(prisma, {
    organizationId,
    contactId,
    connectionId,
    text,
    direction: fromMe ? "out" : "in",
    time: normalized.time,
    status: "sent",
    externalMessageId: normalized.id,
  });

  if (created) await triggerAutomations(organizationId, "CONTACT_CREATED", { contactId, connectionId });
  if (!fromMe && !inbound.duplicate) {
    await triggerAutomations(organizationId, "MESSAGE_RECEIVED", { contactId, connectionId, payload: { connectionId, text, messageId: normalized.id } });
    await markCampaignResponse(organizationId, contactId, connectionId);
  }

  await logWebhook({ organizationId, connectionId, source: "evolution", event, statusCode: 200, detail: inbound.duplicate ? "Evento duplicado ignorado" : undefined, payload: body });

  return NextResponse.json({ ok: true, duplicate: inbound.duplicate });
}
