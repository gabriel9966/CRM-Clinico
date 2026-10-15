import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { createMockPrisma } from "../../../../../../test/mock-prisma";

const mockPrisma = createMockPrisma();
vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/providers/evolution", () => ({ sendText: vi.fn() }));
vi.mock("@/lib/providers/instagram", () => ({ sendText: vi.fn() }));
vi.mock("@/lib/mcp-config", () => ({ resolveOrgByMcpApiKey: vi.fn() }));

const { resolveOrgByMcpApiKey } = await import("@/lib/mcp-config");
const { POST } = await import("../route");

function req(url: string, init?: { method?: string; body?: string; authed?: boolean; headers?: HeadersInit }) {
  const headers = new Headers(init?.headers);
  if (init?.authed !== false) headers.set("authorization", "Bearer valid-key");
  return new NextRequest(url, { method: init?.method, body: init?.body, headers });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(resolveOrgByMcpApiKey).mockResolvedValue("org-1");
});

describe("POST /api/v1/messages", () => {
  it("retorna 400 sem contactId/text", async () => {
    const res = await POST(req("https://x.com/api/v1/messages", { method: "POST", body: JSON.stringify({}) }));
    expect(res.status).toBe(400);
  });

  it("retorna 404 quando o contato não pertence à organização", async () => {
    mockPrisma.contact.findFirst.mockResolvedValue(null);
    const res = await POST(
      req("https://x.com/api/v1/messages", {
        method: "POST",
        body: JSON.stringify({ contactId: "foreign", text: "Oi" }),
      })
    );
    expect(res.status).toBe(404);
  });

  it("registra a mensagem e retorna 201 quando o contato é válido e sem canal conectado", async () => {
    mockPrisma.contact.findFirst.mockResolvedValue({ id: "c1", organizationId: "org-1" });
    mockPrisma.contactChannel.findFirst.mockResolvedValue(null);
    const time = new Date("2030-01-01T12:00:00Z");
    mockPrisma.message.create.mockResolvedValue({
      id: "msg-1", organizationId: "org-1", contactId: "c1", text: "Oi", direction: "out", time,
    });
    mockPrisma.contact.updateMany.mockResolvedValue({ count: 1 });

    const res = await POST(
      req("https://x.com/api/v1/messages", { method: "POST", body: JSON.stringify({ contactId: "c1", text: "Oi" }) })
    );
    expect(res.status).toBe(201);
    expect(mockPrisma.message.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ organizationId: "org-1", contactId: "c1", direction: "out" }) })
    );
    // atualiza o resumo da última mensagem do contato (usado pela lista de conversas)
    expect(mockPrisma.contact.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: "c1", organizationId: "org-1" }),
        data: { lastMessageAt: time, lastMessageText: "Oi", lastMessageDirection: "out" },
      })
    );
  });
});
