import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";

vi.mock("../mcp-config", () => ({ resolveOrgByMcpApiKey: vi.fn() }));
const { resolveOrgByMcpApiKey } = await import("../mcp-config");
const { resolveApiOrg, withApiAuth } = await import("../api-auth");

function makeRequest(authHeader?: string) {
  const headers = new Headers();
  if (authHeader) headers.set("authorization", authHeader);
  return new NextRequest("https://example.com/api/v1/contacts", { headers });
}

beforeEach(() => vi.clearAllMocks());

describe("resolveApiOrg", () => {
  it("retorna null sem header Authorization", async () => {
    expect(await resolveApiOrg(makeRequest())).toBeNull();
    expect(resolveOrgByMcpApiKey).not.toHaveBeenCalled();
  });

  it("retorna null quando o header não é Bearer", async () => {
    expect(await resolveApiOrg(makeRequest("Basic abc123"))).toBeNull();
  });

  it("extrai o token e delega pra resolveOrgByMcpApiKey", async () => {
    vi.mocked(resolveOrgByMcpApiKey).mockResolvedValue("org-123");
    const result = await resolveApiOrg(makeRequest("Bearer mcp_abc"));
    expect(result).toBe("org-123");
    expect(resolveOrgByMcpApiKey).toHaveBeenCalledWith("mcp_abc");
  });
});

describe("withApiAuth", () => {
  it("responde 401 quando não autenticado, sem chamar o handler", async () => {
    vi.mocked(resolveOrgByMcpApiKey).mockResolvedValue(null);
    const handler = vi.fn();
    const res = await withApiAuth(makeRequest("Bearer invalid"), handler);
    expect(res.status).toBe(401);
    expect(handler).not.toHaveBeenCalled();
  });

  it("chama o handler com a organizationId resolvida", async () => {
    vi.mocked(resolveOrgByMcpApiKey).mockResolvedValue("org-456");
    const handler = vi.fn().mockResolvedValue(NextResponse.json({ ok: true }));
    const res = await withApiAuth(makeRequest("Bearer valid"), handler);
    expect(handler).toHaveBeenCalledWith("org-456");
    expect(res.status).toBe(200);
  });

  it("converte exceções do handler em 500 em vez de derrubar a rota", async () => {
    vi.mocked(resolveOrgByMcpApiKey).mockResolvedValue("org-456");
    const handler = vi.fn().mockRejectedValue(new Error("boom"));
    const res = await withApiAuth(makeRequest("Bearer valid"), handler);
    expect(res.status).toBe(500);
  });
});
