import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { createHmac } from "crypto";
import { resetAllRateLimits } from "../rate-limit";

process.env.CONNECTIONS_SECRET = "segredo-de-teste";
process.env.APP_BASE_URL = "https://crm.exemplo.com/";

const { webhookToken, checkWebhookToken, guardWebhook, webhookUrl, verifyMetaSignature } = await import("../webhook-auth");

const req = (qs = "", headers: HeadersInit = {}) =>
  new NextRequest(`https://crm.exemplo.com/api/webhooks/evolution/c1${qs}`, { method: "POST", headers });

beforeEach(() => {
  resetAllRateLimits();
  delete process.env.WEBHOOK_REQUIRE_TOKEN;
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("webhookToken", () => {
  it("é estável, depende do id e do tipo", () => {
    expect(webhookToken("evolution", "c1")).toBe(webhookToken("evolution", "c1"));
    expect(webhookToken("evolution", "c1")).not.toBe(webhookToken("evolution", "c2"));
    expect(webhookToken("evolution", "c1")).not.toBe(webhookToken("email", "c1"));
    expect(webhookToken("evolution", "c1")).toMatch(/^[0-9a-f]{40}$/);
  });
});

describe("checkWebhookToken", () => {
  it("aceita token correto na query ou no cabeçalho", () => {
    const t = webhookToken("evolution", "c1");
    expect(checkWebhookToken(req(`?token=${t}`), "evolution", "c1")).toBe("ok");
    expect(checkWebhookToken(req("", { "x-webhook-token": t }), "evolution", "c1")).toBe("ok");
  });

  it("recusa token errado e token de outro id", () => {
    expect(checkWebhookToken(req("?token=errado"), "evolution", "c1")).toBe("invalid");
    expect(checkWebhookToken(req(`?token=${webhookToken("evolution", "c2")}`), "evolution", "c1")).toBe("invalid");
  });

  it("sem token devolve 'missing'", () => {
    expect(checkWebhookToken(req(), "evolution", "c1")).toBe("missing");
  });
});

describe("guardWebhook", () => {
  it("token correto passa", async () => {
    expect(await guardWebhook(req(`?token=${webhookToken("evolution", "c1")}`), "evolution", "c1")).toBeNull();
  });

  it("token errado é 401 mesmo no modo de migração", async () => {
    const res = await guardWebhook(req("?token=errado"), "evolution", "c1");
    expect(res?.status).toBe(401);
    expect(await res?.json()).toMatchObject({ error: "invalid_token" });
  });

  it("sem token: passa (migração) e registra aviso", async () => {
    expect(await guardWebhook(req(), "evolution", "c1")).toBeNull();
    expect(console.warn).toHaveBeenCalled();
  });

  it("sem token com WEBHOOK_REQUIRE_TOKEN=true: 401", async () => {
    process.env.WEBHOOK_REQUIRE_TOKEN = "true";
    const res = await guardWebhook(req(), "evolution", "c1");
    expect(res?.status).toBe(401);
    expect(await res?.json()).toMatchObject({ error: "token_required" });
  });

  it("aplica rate limit por origem (429 com Retry-After)", async () => {
    const t = webhookToken("evolution", "c1");
    let last = null;
    for (let i = 0; i < 241; i++) last = await guardWebhook(req(`?token=${t}`, { "x-real-ip": "7.7.7.7" }), "evolution", "c1");
    expect(last?.status).toBe(429);
    expect(last?.headers.get("retry-after")).toBeTruthy();
    // outra origem não é afetada
    expect(await guardWebhook(req(`?token=${t}`, { "x-real-ip": "8.8.8.8" }), "evolution", "c1")).toBeNull();
  });
});

describe("webhookUrl", () => {
  it("monta a URL pública com token e sem barra dupla", () => {
    expect(webhookUrl("email", "c9")).toBe(`https://crm.exemplo.com/api/webhooks/email/c9?token=${webhookToken("email", "c9")}`);
  });
});

describe("verifyMetaSignature", () => {
  const body = '{"entry":[]}';
  const sign = (b: string, secret: string) => "sha256=" + createHmac("sha256", secret).update(b).digest("hex");

  it("sem app secret configurado recusa o webhook", () => {
    expect(verifyMetaSignature(body, null, undefined)).toEqual({ ok: false, enforced: false });
  });

  it("aceita assinatura válida", () => {
    expect(verifyMetaSignature(body, sign(body, "s3"), "s3")).toEqual({ ok: true, enforced: true });
  });

  it("recusa corpo adulterado, assinatura de outro segredo e cabeçalho ausente", () => {
    expect(verifyMetaSignature(body + " ", sign(body, "s3"), "s3").ok).toBe(false);
    expect(verifyMetaSignature(body, sign(body, "outro"), "s3").ok).toBe(false);
    expect(verifyMetaSignature(body, null, "s3").ok).toBe(false);
    expect(verifyMetaSignature(body, "sha256=curto", "s3").ok).toBe(false);
  });
});
