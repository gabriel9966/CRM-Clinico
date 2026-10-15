import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock de next/headers: um "cookie jar" em memória compartilhado entre
// createSession/readSession/destroySession, do jeito que o Next faria
// dentro de uma mesma requisição.
const store = new Map<string, { value: string }>();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    set: (name: string, value: string) => store.set(name, { value }),
    get: (name: string) => store.get(name),
    delete: (name: string) => store.delete(name),
  }),
}));

const { createSession, readSession, destroySession } = await import("../session");

beforeEach(() => {
  store.clear();
});

describe("session (JWT em cookie)", () => {
  it("createSession + readSession faz o round-trip do userId", async () => {
    await createSession("user-123");
    const session = await readSession();
    expect(session).toEqual({ userId: "user-123" });
  });

  it("readSession retorna null sem cookie", async () => {
    expect(await readSession()).toBeNull();
  });

  it("readSession retorna null para um token adulterado", async () => {
    await createSession("user-123");
    const cookie = store.get("crm_session")!;
    store.set("crm_session", { value: cookie.value.slice(0, -4) + "aaaa" });
    expect(await readSession()).toBeNull();
  });

  it("destroySession remove o cookie, e a sessão para de ser válida", async () => {
    await createSession("user-123");
    await destroySession();
    expect(await readSession()).toBeNull();
  });

  it("não aceita um JWT assinado com outro segredo", async () => {
    const { SignJWT } = await import("jose");
    const otherSecret = new TextEncoder().encode("um-segredo-completamente-diferente-e-longo");
    const forged = await new SignJWT({ userId: "attacker" })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(otherSecret);
    store.set("crm_session", { value: forged });
    expect(await readSession()).toBeNull();
  });
});
