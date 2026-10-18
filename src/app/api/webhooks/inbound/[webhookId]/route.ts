import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { guardWebhook } from "@/lib/webhook-auth";
import { assignNextOwner } from "@/lib/assignment";
import { syncTags } from "@/lib/crm-catalog";
import { triggerAutomations } from "@/lib/automation/engine";
import { logWebhook } from "@/lib/webhook-log";

function valueAt(payload: unknown, path: string): unknown {
  if (!path.trim()) return undefined;
  return path.split(".").filter(Boolean).reduce<unknown>((current, key) => current && typeof current === "object" ? (current as Record<string, unknown>)[key] : undefined, payload);
}
const text = (value: unknown) => typeof value === "string" || typeof value === "number" ? String(value).trim() : "";

export async function POST(req: NextRequest, { params }: { params: Promise<{ webhookId: string }> }) {
  const { webhookId } = await params;
  const denied = guardWebhook(req, "inbound", webhookId);
  if (denied) return denied;
  const webhook = await prisma.inboundWebhook.findUnique({ where: { id: webhookId } });
  if (!webhook || !webhook.enabled) return NextResponse.json({ ok: false }, { status: 404 });
  const payload = await req.json().catch(() => null);
  if (!payload || typeof payload !== "object") return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  let mapping: Record<string, string> = {};
  try { mapping = JSON.parse(webhook.mapping) as Record<string, string>; } catch { /* configuração vazia */ }
  const name = text(valueAt(payload, mapping.name || "name")) || "Novo lead";
  const phone = text(valueAt(payload, mapping.phone || "phone")) || null;
  const email = text(valueAt(payload, mapping.email || "email")) || null;
  const company = text(valueAt(payload, mapping.company || "company")) || null;
  const rawTags = valueAt(payload, mapping.tags || "tags");
  const tags = Array.isArray(rawTags) ? rawTags.map(text).filter(Boolean) : text(rawTags).split(",").map((tag) => tag.trim()).filter(Boolean);
  const existing = await prisma.contact.findFirst({ where: { organizationId: webhook.organizationId, OR: [...(email ? [{ email }] : []), ...(phone ? [{ phone }] : [])] } });
  await syncTags(webhook.organizationId, tags, "contact");
  const contact = existing
    ? await prisma.contact.update({ where: { id: existing.id }, data: { name: existing.name === "Novo lead" ? name : existing.name, company: existing.company || company, email: existing.email || email, phone: existing.phone || phone, tags: JSON.stringify([...new Set([...JSON.parse(existing.tags || "[]"), ...tags])]) } })
    : await prisma.contact.create({ data: { organizationId: webhook.organizationId, name, phone, email, company, tags: JSON.stringify(tags), ownerId: await assignNextOwner(webhook.organizationId) } });
  if (!existing) await triggerAutomations(webhook.organizationId, "CONTACT_CREATED", { contactId: contact.id });
  for (const tag of tags) await triggerAutomations(webhook.organizationId, "TAG_ADDED", { contactId: contact.id, tag });
  await logWebhook({ organizationId: webhook.organizationId, source: "inbound-form", event: webhook.name, statusCode: 200, detail: existing ? "Contato atualizado" : "Lead criado", payload });
  return NextResponse.json({ ok: true, contactId: contact.id, created: !existing });
}
