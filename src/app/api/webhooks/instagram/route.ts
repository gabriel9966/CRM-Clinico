import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { decryptJson } from "@/lib/crypto";
import { triggerAutomations } from "@/lib/automation/engine";
import { assignNextOwner } from "@/lib/assignment";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { verifyMetaSignature } from "@/lib/webhook-auth";
import { ensureLiveContact } from "@/lib/inbound";
import { createMessage } from "@/lib/messages";
import { logWebhook } from "@/lib/webhook-log";

// Webhook único para todas as conexões de Instagram (a Meta exige uma URL fixa
// por App cadastrado no Meta for Developers — a instância é identificada pelo
// `recipient.id` de cada evento, que casamos com o `igUserId` salvo em cada
// Connection). Veja o aviso na tela de Conexões: isto só recebe eventos reais
// depois que o usuário tiver um App da Meta aprovado para `instagram_manage_messages`
// e configurar esta URL no painel deles.

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const mode = searchParams.get("hub.mode");
  const token = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");

  if (mode === "subscribe" && token && token === process.env.INSTAGRAM_VERIFY_TOKEN) {
    return new NextResponse(challenge ?? "", { status: 200 });
  }
  return NextResponse.json({ ok: false }, { status: 403 });
}

type InstagramWebhookBody = {
  entry?: Array<{
    messaging?: Array<{
      sender?: { id?: string };
      recipient?: { id?: string };
      message?: { text?: string; is_echo?: boolean };
      timestamp?: number;
    }>;
  }>;
};

export async function POST(req: NextRequest) {
  const rl = rateLimit(`webhook:instagram:${clientIp(req.headers)}`, { limit: 600, windowMs: 60_000 });
  if (!rl.ok) {
    return NextResponse.json({ ok: false }, { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } });
  }

  // A Meta assina o corpo bruto com o App Secret (X-Hub-Signature-256). Só
  // verificamos quando INSTAGRAM_APP_SECRET está configurado, para não quebrar
  // quem ainda não definiu — mas sem ele qualquer um pode forjar eventos.
  const rawBody = await req.text();
  const sig = verifyMetaSignature(rawBody, req.headers.get("x-hub-signature-256"), process.env.INSTAGRAM_APP_SECRET);
  if (!sig.ok) {
    return NextResponse.json({ ok: false, error: "invalid_signature" }, { status: 401 });
  }

  let body: InstagramWebhookBody;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const events = body.entry?.flatMap((e) => e.messaging ?? []) ?? [];

  for (const event of events) {
    const text = event.message?.text;
    const senderId = event.sender?.id;
    const recipientId = event.recipient?.id;
    if (!text || !senderId || !recipientId) continue;

    const isEcho = Boolean(event.message?.is_echo);
    const externalId = isEcho ? undefined : senderId;

    const connections = await prisma.connection.findMany({ where: { provider: "INSTAGRAM" } });
    const connection = connections.find((c) => {
      const cfg = decryptJson<{ igUserId?: string }>(c.config);
      return cfg.igUserId === recipientId;
    });
    if (!connection || !externalId) continue;

    const organizationId = connection.organizationId;

    let channel = await prisma.contactChannel.findUnique({
      where: { connectionId_externalId: { connectionId: connection.id, externalId } },
    });
    if (!channel) {
      const contact = await prisma.contact.create({
        data: { organizationId, name: `Instagram ${externalId.slice(-6)}`, ownerId: await assignNextOwner(organizationId) },
      });
      channel = await prisma.contactChannel.create({
        data: { connectionId: connection.id, externalId, contactId: contact.id },
      });
    }

    const contactId = await ensureLiveContact(channel, organizationId, { name: `Instagram ${externalId.slice(-6)}` });

    await createMessage(prisma, {
      organizationId,
      contactId,
      connectionId: connection.id,
      text,
      direction: isEcho ? "out" : "in",
      time: event.timestamp ? new Date(event.timestamp) : new Date(),
      status: "sent",
    });

    if (!isEcho) {
      await triggerAutomations(organizationId, "MESSAGE_RECEIVED", { contactId });
    }
    await logWebhook({ organizationId, connectionId: connection.id, source: "instagram", event: "messaging", statusCode: 200, payload: event });
  }

  return NextResponse.json({ ok: true });
}
