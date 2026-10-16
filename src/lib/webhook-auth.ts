import "server-only";
import { createHmac, timingSafeEqual } from "crypto";
import { NextResponse, type NextRequest } from "next/server";
import { clientIp, rateLimit } from "./rate-limit";

// Autenticação dos webhooks de entrada. Antes, o único "segredo" era o id da
// conexão na URL (que aparece em telas, logs e histórico de navegador). Agora
// cada URL leva também um token HMAC derivado do CONNECTIONS_SECRET, que não
// dá para adivinhar nem calcular só conhecendo o id.
//
// Migração sem quebrar o que já está configurado: URLs antigas (sem token)
// continuam aceitas até WEBHOOK_REQUIRE_TOKEN=true. Token presente e errado é
// sempre recusado.

export type WebhookKind = "evolution" | "email" | "azap" | "inbound" | "automation";

function secret(): string {
  const s = process.env.CONNECTIONS_SECRET;
  if (!s) throw new Error("CONNECTIONS_SECRET não configurado");
  return s;
}

export function webhookToken(kind: WebhookKind, id: string): string {
  return createHmac("sha256", secret()).update(`webhook:${kind}:${id}`).digest("hex").slice(0, 40);
}

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

export type TokenCheck = "ok" | "missing" | "invalid";

export function checkWebhookToken(req: NextRequest, kind: WebhookKind, id: string): TokenCheck {
  const given = req.nextUrl.searchParams.get("token") ?? req.headers.get("x-webhook-token");
  if (!given) return "missing";
  return safeEqual(given, webhookToken(kind, id)) ? "ok" : "invalid";
}

const WEBHOOK_LIMIT = { limit: 240, windowMs: 60_000 };

/**
 * Porta de entrada de todo webhook com id na URL: limita a taxa por origem e
 * confere o token. Devolve a resposta de recusa, ou null se pode seguir.
 */
export function guardWebhook(req: NextRequest, kind: WebhookKind, id: string): NextResponse | null {
  const ip = clientIp(req.headers);
  const rl = rateLimit(`webhook:${kind}:${id}:${ip}`, WEBHOOK_LIMIT);
  if (!rl.ok) {
    return NextResponse.json(
      { ok: false, error: "rate_limited" },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } }
    );
  }

  const check = checkWebhookToken(req, kind, id);
  if (check === "invalid") {
    return NextResponse.json({ ok: false, error: "invalid_token" }, { status: 401 });
  }
  if (check === "missing") {
    if (process.env.WEBHOOK_REQUIRE_TOKEN === "true") {
      return NextResponse.json({ ok: false, error: "token_required" }, { status: 401 });
    }
    console.warn(`[webhook] ${kind}/${id} chamado sem token — atualize a URL (WEBHOOK_REQUIRE_TOKEN=true bloqueia)`);
  }
  return null;
}

/** URL pública do webhook, já com o token. */
export function webhookUrl(kind: WebhookKind, id: string): string {
  const base = (process.env.APP_BASE_URL || "http://localhost:3000").replace(/\/+$/, "");
  return `${base}/api/webhooks/${kind}/${id}?token=${webhookToken(kind, id)}`;
}

/**
 * Assinatura do Instagram/Meta: X-Hub-Signature-256 = "sha256=" + HMAC-SHA256
 * do corpo bruto com o App Secret. `appSecret` vazio = verificação desligada
 * (mantém o comportamento antigo até o segredo ser configurado).
 */
export function verifyMetaSignature(rawBody: string, header: string | null, appSecret: string | undefined) {
  if (!appSecret) return { ok: true as const, enforced: false as const };
  if (!header?.startsWith("sha256=")) return { ok: false as const, enforced: true as const };
  const expected = createHmac("sha256", appSecret).update(rawBody).digest("hex");
  return { ok: safeEqual(header.slice(7), expected), enforced: true as const };
}
