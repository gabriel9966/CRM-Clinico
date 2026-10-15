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
const { PATCH, DELETE } = await import("../[id]/route");

function req(url: string, init?: { method?: string; body?: string; authed?: boolean; headers?: HeadersInit }) {
  const headers = new Headers(init?.headers);
  if (init?.authed !== false) headers.set("authorization", "Bearer valid-key");
  return new NextRequest(url, { method: init?.method, body: init?.body, headers });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(resolveOrgByMcpApiKey).mockResolvedValue("org-1");
});

describe("GET /api/v1/activities", () => {
  it("interpreta done=true/false corretamente, e omite o filtro quando ausente", async () => {
    mockPrisma.activity.findMany.mockResolvedValue([]);

    await GET(req("https://x.com/api/v1/activities"));
    expect(mockPrisma.activity.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ done: undefined }) })
    );

    await GET(req("https://x.com/api/v1/activities?done=true"));
    expect(mockPrisma.activity.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ done: true }) })
    );

    await GET(req("https://x.com/api/v1/activities?done=false"));
    expect(mockPrisma.activity.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ done: false }) })
    );
  });
});

describe("POST /api/v1/activities", () => {
  it("retorna 400 sem title/dueAt", async () => {
    const res = await POST(req("https://x.com/api/v1/activities", { method: "POST", body: JSON.stringify({}) }));
    expect(res.status).toBe(400);
  });

  it("cria e retorna 201", async () => {
    mockPrisma.activity.create.mockResolvedValue({ id: "act-1" });
    const res = await POST(
      req("https://x.com/api/v1/activities", {
        method: "POST",
        body: JSON.stringify({ title: "Ligar", dueAt: "2026-01-01T10:00:00.000Z" }),
      })
    );
    expect(res.status).toBe(201);
    expect(mockPrisma.activity.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ organizationId: "org-1" }) })
    );
  });
});

describe("PATCH /api/v1/activities/:id", () => {
  it("retorna 404 para tarefa de outra organização", async () => {
    mockPrisma.activity.findFirst.mockResolvedValue(null);
    const res = await PATCH(
      req("https://x.com/api/v1/activities/foreign", { method: "PATCH", body: JSON.stringify({ done: true }) }),
      { params: Promise.resolve({ id: "foreign" }) }
    );
    expect(res.status).toBe(404);
    expect(mockPrisma.activity.update).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/v1/activities/:id", () => {
  it("retorna 404 para tarefa de outra organização", async () => {
    mockPrisma.activity.findFirst.mockResolvedValue(null);
    const res = await DELETE(req("https://x.com/api/v1/activities/foreign", { method: "DELETE" }), {
      params: Promise.resolve({ id: "foreign" }),
    });
    expect(res.status).toBe(404);
  });
});
