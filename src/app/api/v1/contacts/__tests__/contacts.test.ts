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
const { GET: GET_ONE, PATCH, DELETE } = await import("../[id]/route");

function req(url: string, init?: { method?: string; body?: string; authed?: boolean; headers?: HeadersInit }) {
  const headers = new Headers(init?.headers);
  if (init?.authed !== false) headers.set("authorization", "Bearer valid-key");
  return new NextRequest(url, { method: init?.method, body: init?.body, headers });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(resolveOrgByMcpApiKey).mockResolvedValue("org-1");
});

describe("GET /api/v1/contacts", () => {
  it("retorna 401 sem chave de API", async () => {
    vi.mocked(resolveOrgByMcpApiKey).mockResolvedValue(null);
    const res = await GET(req("https://x.com/api/v1/contacts", { authed: false }));
    expect(res.status).toBe(401);
  });

  it("lista contatos da organização resolvida pela chave", async () => {
    mockPrisma.contact.findMany.mockResolvedValue([
      { id: "c1", name: "Marina", company: null, email: null, phone: null, tags: "[]", ownerId: null },
    ]);
    const res = await GET(req("https://x.com/api/v1/contacts"));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data).toHaveLength(1);
    expect(body.data[0].name).toBe("Marina");
  });

  it("repassa ?search= como filtro", async () => {
    mockPrisma.contact.findMany.mockResolvedValue([]);
    await GET(req("https://x.com/api/v1/contacts?search=maria"));
    expect(mockPrisma.contact.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ organizationId: "org-1", OR: expect.any(Array) }),
      })
    );
  });
});

describe("POST /api/v1/contacts", () => {
  it("retorna 400 sem o campo obrigatório 'name'", async () => {
    const res = await POST(req("https://x.com/api/v1/contacts", { method: "POST", body: JSON.stringify({}) }));
    expect(res.status).toBe(400);
    expect(mockPrisma.contact.create).not.toHaveBeenCalled();
  });

  it("cria o contato e retorna 201", async () => {
    mockPrisma.contact.create.mockResolvedValue({ id: "new-id" });
    const res = await POST(
      req("https://x.com/api/v1/contacts", { method: "POST", body: JSON.stringify({ name: "Rafael" }) })
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data.id).toBe("new-id");
  });
});

describe("GET /api/v1/contacts/:id", () => {
  it("retorna 404 quando o contato não existe na organização", async () => {
    mockPrisma.contact.findFirst.mockResolvedValue(null);
    const res = await GET_ONE(req("https://x.com/api/v1/contacts/missing"), {
      params: Promise.resolve({ id: "missing" }),
    });
    expect(res.status).toBe(404);
  });

  it("retorna 200 com o contato quando existe", async () => {
    mockPrisma.contact.findFirst.mockResolvedValue({
      id: "c1",
      organizationId: "org-1",
      tags: "[]",
      opportunities: [],
      messages: [],
    });
    const res = await GET_ONE(req("https://x.com/api/v1/contacts/c1"), { params: Promise.resolve({ id: "c1" }) });
    expect(res.status).toBe(200);
  });
});

describe("PATCH /api/v1/contacts/:id", () => {
  it("retorna 404 ao tentar editar contato de outra organização", async () => {
    mockPrisma.contact.findFirst.mockResolvedValue(null);
    const res = await PATCH(
      req("https://x.com/api/v1/contacts/foreign", { method: "PATCH", body: JSON.stringify({ name: "x" }) }),
      { params: Promise.resolve({ id: "foreign" }) }
    );
    expect(res.status).toBe(404);
  });
});

describe("DELETE /api/v1/contacts/:id", () => {
  it("retorna 404 ao tentar apagar contato de outra organização", async () => {
    mockPrisma.contact.findFirst.mockResolvedValue(null);
    const res = await DELETE(req("https://x.com/api/v1/contacts/foreign", { method: "DELETE" }), {
      params: Promise.resolve({ id: "foreign" }),
    });
    expect(res.status).toBe(404);
    expect(mockPrisma.contact.updateMany).not.toHaveBeenCalled();
    expect(mockPrisma.contact.delete).not.toHaveBeenCalled();
  });

  it("manda para a lixeira (não apaga de verdade) e retorna 200 quando o contato pertence à organização", async () => {
    mockPrisma.contact.findFirst.mockResolvedValue({ id: "c1", organizationId: "org-1" });
    mockPrisma.contact.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.opportunity.updateMany.mockResolvedValue({ count: 0 });
    mockPrisma.appointment.updateMany.mockResolvedValue({ count: 0 });
    mockPrisma.auditLog.create.mockResolvedValue({});
    const res = await DELETE(req("https://x.com/api/v1/contacts/c1", { method: "DELETE" }), {
      params: Promise.resolve({ id: "c1" }),
    });
    expect(res.status).toBe(200);
    expect(mockPrisma.contact.delete).not.toHaveBeenCalled();
    expect(mockPrisma.contact.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["c1"] }, organizationId: "org-1" },
      data: { deletedAt: expect.any(Date) },
    });
    // leva junto os negócios e agendamentos do contato
    expect(mockPrisma.opportunity.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { contactId: { in: ["c1"] }, organizationId: "org-1" } })
    );
    expect(mockPrisma.appointment.updateMany).toHaveBeenCalled();
    expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: "contact.deleted", organizationId: "org-1" }) })
    );
  });
});
