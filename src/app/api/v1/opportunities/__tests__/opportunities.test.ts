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

describe("GET /api/v1/opportunities", () => {
  it("retorna 401 sem chave de API", async () => {
    vi.mocked(resolveOrgByMcpApiKey).mockResolvedValue(null);
    const res = await GET(req("https://x.com/api/v1/opportunities", { authed: false }));
    expect(res.status).toBe(401);
  });

  it("repassa filtros da query string", async () => {
    mockPrisma.opportunity.findMany.mockResolvedValue([]);
    await GET(req("https://x.com/api/v1/opportunities?pipelineId=p1&stageId=s1&contactId=c1"));
    expect(mockPrisma.opportunity.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ organizationId: "org-1", pipelineId: "p1", stageId: "s1", contactId: "c1" }),
      })
    );
  });
});

describe("POST /api/v1/opportunities", () => {
  it("retorna 400 sem campos obrigatórios", async () => {
    const res = await POST(req("https://x.com/api/v1/opportunities", { method: "POST", body: JSON.stringify({ title: "x" }) }));
    expect(res.status).toBe(400);
    expect(mockPrisma.opportunity.create).not.toHaveBeenCalled();
  });

  it("retorna 404 quando o contato não pertence à organização", async () => {
    mockPrisma.contact.findFirst.mockResolvedValue(null);
    const res = await POST(
      req("https://x.com/api/v1/opportunities", {
        method: "POST",
        body: JSON.stringify({ title: "Venda", contactId: "foreign", pipelineId: "p1", stageId: "s1" }),
      })
    );
    expect(res.status).toBe(404);
  });

  it("cria e retorna 201 quando válido", async () => {
    mockPrisma.contact.findFirst.mockResolvedValue({ id: "c1", organizationId: "org-1" });
    mockPrisma.stage.findFirst.mockResolvedValue({ id: "s1" });
    mockPrisma.opportunity.create.mockResolvedValue({ id: "opp-1" });
    const res = await POST(
      req("https://x.com/api/v1/opportunities", {
        method: "POST",
        body: JSON.stringify({ title: "Venda", contactId: "c1", pipelineId: "p1", stageId: "s1" }),
      })
    );
    expect(res.status).toBe(201);
    // a etapa é conferida contra o pipeline E a organização da chave
    expect(mockPrisma.stage.findFirst).toHaveBeenCalledWith({
      where: { id: "s1", pipelineId: "p1", pipeline: { organizationId: "org-1" } },
      select: { id: true },
    });
  });

  it("retorna 404 quando a etapa/pipeline é de outra organização (e não cria)", async () => {
    mockPrisma.contact.findFirst.mockResolvedValue({ id: "c1", organizationId: "org-1" });
    mockPrisma.stage.findFirst.mockResolvedValue(null);
    const res = await POST(
      req("https://x.com/api/v1/opportunities", {
        method: "POST",
        body: JSON.stringify({ title: "Venda", contactId: "c1", pipelineId: "p-outra-org", stageId: "s-outra-org" }),
      })
    );
    expect(res.status).toBe(404);
    expect(mockPrisma.opportunity.create).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/v1/opportunities/:id", () => {
  it("retorna 404 para oportunidade de outra organização", async () => {
    mockPrisma.opportunity.findFirst.mockResolvedValue(null);
    const res = await PATCH(
      req("https://x.com/api/v1/opportunities/foreign", { method: "PATCH", body: JSON.stringify({ title: "x" }) }),
      { params: Promise.resolve({ id: "foreign" }) }
    );
    expect(res.status).toBe(404);
    expect(mockPrisma.opportunity.update).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/v1/opportunities/:id", () => {
  it("retorna 404 para oportunidade de outra organização", async () => {
    mockPrisma.opportunity.findFirst.mockResolvedValue(null);
    const res = await DELETE(req("https://x.com/api/v1/opportunities/foreign", { method: "DELETE" }), {
      params: Promise.resolve({ id: "foreign" }),
    });
    expect(res.status).toBe(404);
    expect(mockPrisma.opportunity.updateMany).not.toHaveBeenCalled();
    expect(mockPrisma.opportunity.delete).not.toHaveBeenCalled();
  });

  it("manda para a lixeira quando pertence à organização", async () => {
    mockPrisma.opportunity.findFirst.mockResolvedValue({ id: "opp-1", organizationId: "org-1" });
    mockPrisma.opportunity.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.auditLog.create.mockResolvedValue({});
    const res = await DELETE(req("https://x.com/api/v1/opportunities/opp-1", { method: "DELETE" }), {
      params: Promise.resolve({ id: "opp-1" }),
    });
    expect(res.status).toBe(200);
    expect(mockPrisma.opportunity.delete).not.toHaveBeenCalled();
    expect(mockPrisma.opportunity.updateMany).toHaveBeenCalledWith({
      where: { id: "opp-1", organizationId: "org-1" },
      data: { deletedAt: expect.any(Date) },
    });
  });
});
