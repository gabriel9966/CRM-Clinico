import { describe, it, expect, beforeEach } from "vitest";
import { rateLimit, clearRateLimit, resetAllRateLimits, clientIp } from "../rate-limit";

const OPTS = { limit: 3, windowMs: 1000 };

beforeEach(() => resetAllRateLimits());

describe("rateLimit", () => {
  it("permite até o limite e bloqueia a próxima tentativa", () => {
    expect(rateLimit("k", OPTS, 0).ok).toBe(true);
    expect(rateLimit("k", OPTS, 1).ok).toBe(true);
    const third = rateLimit("k", OPTS, 2);
    expect(third).toMatchObject({ ok: true, remaining: 0 });
    const fourth = rateLimit("k", OPTS, 3);
    expect(fourth.ok).toBe(false);
    expect(fourth.retryAfterSec).toBeGreaterThanOrEqual(1);
  });

  it("libera de novo quando a janela expira", () => {
    for (let i = 0; i < 4; i++) rateLimit("k", OPTS, i);
    expect(rateLimit("k", OPTS, 5).ok).toBe(false);
    expect(rateLimit("k", OPTS, 1001).ok).toBe(true);
  });

  it("chaves diferentes não se afetam", () => {
    for (let i = 0; i < 5; i++) rateLimit("a", OPTS, i);
    expect(rateLimit("a", OPTS, 6).ok).toBe(false);
    expect(rateLimit("b", OPTS, 6).ok).toBe(true);
  });

  it("clearRateLimit zera o contador (login bem-sucedido)", () => {
    for (let i = 0; i < 5; i++) rateLimit("k", OPTS, i);
    clearRateLimit("k");
    expect(rateLimit("k", OPTS, 6).ok).toBe(true);
  });
});

describe("clientIp", () => {
  it("prefere x-real-ip, definido pelo nginx", () => {
    const h = new Headers({ "x-real-ip": "1.2.3.4", "x-forwarded-for": "9.9.9.9, 1.2.3.4" });
    expect(clientIp(h)).toBe("1.2.3.4");
  });

  it("sem x-real-ip usa o ÚLTIMO item do x-forwarded-for (o primeiro pode ser forjado)", () => {
    const h = new Headers({ "x-forwarded-for": "6.6.6.6, 5.5.5.5, 1.2.3.4" });
    expect(clientIp(h)).toBe("1.2.3.4");
  });

  it("sem cabeçalhos devolve 'unknown'", () => {
    expect(clientIp(new Headers())).toBe("unknown");
  });
});
