import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { createMockPrisma } from "../../../../../../test/mock-prisma";

const mockPrisma = createMockPrisma();
vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/providers/evolution", () => ({ sendText: vi.fn() }));
vi.mock("@/lib/providers/instagram", () => ({ sendText: vi.fn() }));
vi.mock("@/lib/mcp-config", () => ({ resolveOrgByMcpApiKey: vi.fn() }));

const { resolveOrgByMcpApiKey } = await import("@/lib/mcp-config");
const { GET, POST } = await import("../route");

function req(url: string, init?: { method?: string; body?: string; authed?: boolean; headers?: HeadersInit }) {
  const headers = new Headers(init?.headers);
  if (init?.authed !== false) headers.set("authorization", "Bearer valid-key");
  return new NextRequest(url, { method: init?.method, body: init?.body, headers });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(resolveOrgByMcpApiKey).mockResolvedValue("org-1");
});

describe("GET /api/v1/appointments", () => {
  it("retorna 401 sem chave", async () => {
    vi.mocked(resolveOrgByMcpApiKey).mockResolvedValue(null);
    const res = await GET(req("https://x.com/api/v1/appointments", { authed: false }));
    expect(res.status).toBe(401);
  });

  it("filtra por organizationId e contactId opcional", async () => {
    mockPrisma.appointment.findMany.mockResolvedValue([]);
    await GET(req("https://x.com/api/v1/appointments?contactId=c1"));
    expect(mockPrisma.appointment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { organizationId: "org-1", contactId: "c1" } })
    );
  });
});

describe("POST /api/v1/appointments", () => {
  it("retorna 400 sem campos obrigatórios", async () => {
    const res = await POST(
      req("https://x.com/api/v1/appointments", { method: "POST", body: JSON.stringify({ title: "Reunião" }) })
    );
    expect(res.status).toBe(400);
    expect(mockPrisma.appointment.create).not.toHaveBeenCalled();
  });

  it("cria e retorna 201 com organizationId correto", async () => {
    mockPrisma.appointment.create.mockResolvedValue({ id: "appt-1" });
    const res = await POST(
      req("https://x.com/api/v1/appointments", {
        method: "POST",
        body: JSON.stringify({ title: "Reunião", startAt: "2026-01-01T10:00:00.000Z", endAt: "2026-01-01T11:00:00.000Z" }),
      })
    );
    expect(res.status).toBe(201);
    expect(mockPrisma.appointment.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ organizationId: "org-1" }) })
    );
  });
});
