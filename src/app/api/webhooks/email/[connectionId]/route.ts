import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { triggerAutomations } from "@/lib/automation/engine";
import { assignNextOwner } from "@/lib/assignment";
import { guardWebhook } from "@/lib/webhook-auth";
import { ensureLiveContact } from "@/lib/inbound";
import { createMessage } from "@/lib/messages";
import { logWebhook } from "@/lib/webhook-log";

// Recebe e-mails inbound da conexão de e-mail do usuário (configurada em
// /connections) e grava como Message + Contact no CRM, igual ao webhook da
// Evolution API — a própria URL (com o id da conexão) funciona como segredo
// de rota. O formato exato do payload varia por provedor de inbound e-mail
// (Resend Inbound, Postmark Inbound Webhook, etc.); este handler aceita os
// nomes de campo mais comuns (from/to/subject/text ou From/Subject/TextBody)
// — ajuste aqui para o formato exato do provedor escolhido ao configurar o
// endpoint de inbound no painel dele.
type EmailWebhookBody = {
  from?: string;
  From?: string;
  subject?: string;
  Subject?: string;
  text?: string;
  TextBody?: string;
};

function pick(...values: (string | undefined)[]): string | null {
  for (const v of values) if (v) return v;
  return null;
}

function extractEmailAddress(raw: string): string {
  const match = raw.match(/<([^>]+)>/);
  return (match ? match[1] : raw).trim().toLowerCase();
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ connectionId: string }> }) {
  const { connectionId } = await params;

  const denied = guardWebhook(req, "email", connectionId);
  if (denied) return denied;

  const connection = await prisma.connection.findUnique({ where: { id: connectionId } });
  if (!connection || connection.provider !== "EMAIL") {
    return NextResponse.json({ ok: false, error: "connection not found" }, { status: 404 });
  }

  let body: EmailWebhookBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 });
  }

  const fromRaw = pick(body.from, body.From);
  const text = pick(body.text, body.TextBody);
  const subject = pick(body.subject, body.Subject) ?? undefined;
  if (!fromRaw || !text) {
    return NextResponse.json({ ok: true, ignored: true });
  }

  const fromAddress = extractEmailAddress(fromRaw);
  const organizationId = connection.organizationId;

  let channel = await prisma.contactChannel.findUnique({
    where: { connectionId_externalId: { connectionId, externalId: fromAddress } },
  });

  if (!channel) {
    const existingContact = await prisma.contact.findFirst({ where: { email: fromAddress, organizationId } });
    const contact =
      existingContact ??
      (await prisma.contact.create({
        data: { organizationId, name: fromAddress, email: fromAddress, ownerId: await assignNextOwner(organizationId) },
      }));

    channel = await prisma.contactChannel.create({
      data: { connectionId, externalId: fromAddress, externalName: fromAddress, contactId: contact.id },
    });
  }

  const contactId = await ensureLiveContact(channel, organizationId, { name: fromAddress, email: fromAddress });

  await createMessage(prisma, {
    organizationId,
    contactId,
    connectionId,
    text: subject ? `${subject}\n\n${text}` : text,
    direction: "in",
    status: "sent",
  });

  await triggerAutomations(organizationId, "MESSAGE_RECEIVED", { contactId });
  await logWebhook({ organizationId, connectionId, source: "email", event: "inbound", statusCode: 200, payload: body });

  return NextResponse.json({ ok: true });
}
