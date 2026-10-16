import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { createMockPrisma } from "../../../../../../test/mock-prisma";

const mockPrisma = createMockPrisma();
vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/crypto", () => ({ decryptJson: vi.fn(() => ({ baseUrl: "http://evo", apiKey: "k", instanceName: "i" })) }));
vi.mock("@/lib/providers/evolution", () => ({ sendText: vi.fn() }));
vi.mock("@/lib/providers/instagram", () => ({ sendText: vi.fn() }));
vi.mock("@/lib/providers/email", () => ({ sendText: vi.fn() }));
vi.mock("@/lib/mcp-config", () => ({ resolveOrgByMcpApiKey: vi.fn() }));

const { resolveOrgByMcpApiKey } = await import("@/lib/mcp-config");
const { decryptJson } = await import("@/lib/crypto");
const evolution = await import("@/lib/providers/evolution");
const { POST } = await import("../route");

function req(url: string, init?: { method?: string; body?: string; authed?: boolean; headers?: HeadersInit }) {
  const headers = new Headers(init?.headers);
  if (init?.authed !== false) headers.set("authorization", "Bearer valid-key");
  return new NextRequest(url, { method: init?.method, body: init?.body, headers });
}

const send = (body: unknown) =>
  POST(req("https://x.com/api/v1/messages", { method: "POST", body: JSON.stringify(body) }));

const wa = { id: "wa1", provider: "WHATSAPP_EVOLUTION", status: "CONNECTED", label: "Recepção", config: "x" };

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(decryptJson).mockReturnValue({ baseUrl: "http://evo", apiKey: "k", instanceName: "i" });
  vi.mocked(resolveOrgByMcpApiKey).mockResolvedValue("org-1");
  mockPrisma.contactChannel.findMany.mockResolvedValue([]);
  mockPrisma.connection.findMany.mockResolvedValue([]);
  mockPrisma.conversation.findFirst.mockResolvedValue({ id: "cv-1" });
  mockPrisma.conversation.updateMany.mockResolvedValue({ count: 1 });
});

describe("POST /api/v1/messages", () => {
  it("retorna 400 sem contactId/text", async () => {
    const res = await send({});
    expect(res.status).toBe(400);
  });

  it("retorna 404 quando o contato não pertence à organização", async () => {
    mockPrisma.contact.findFirst.mockResolvedValue(null);
    const res = await send({ contactId: "foreign", text: "Oi" });
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("contato_nao_encontrado");
  });

  it("contato SEM canal: 409 com o motivo e NADA é gravado como enviado", async () => {
    mockPrisma.contact.findFirst.mockResolvedValue({ id: "c1", name: "Maria", phone: null, email: null });
    const res = await send({ contactId: "c1", text: "Oi" });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe("sem_canal");
    expect(body.detail).toContain("canal");
    expect(mockPrisma.message.create).not.toHaveBeenCalled();
  });

  it("com canal conectado: envia de verdade, registra e retorna 201", async () => {
    mockPrisma.contact.findFirst.mockResolvedValue({ id: "c1", name: "Maria", phone: "(47) 98888-7777", email: null });
    mockPrisma.connection.findMany.mockResolvedValue([wa]);
    mockPrisma.connection.findUniqueOrThrow.mockResolvedValue(wa);
    mockPrisma.contactChannel.create.mockResolvedValue({});
    const time = new Date("2030-01-01T12:00:00Z");
    mockPrisma.message.create.mockResolvedValue({ id: "msg-1", organizationId: "org-1", contactId: "c1", text: "Oi", direction: "out", time });
    mockPrisma.contact.updateMany.mockResolvedValue({ count: 1 });

    const res = await send({ contactId: "c1", text: "Oi" });
    expect(res.status).toBe(201);
    expect((await res.json()).data).toMatchObject({ ok: true, status: "sent", connectionId: "wa1" });
    expect(evolution.sendText).toHaveBeenCalledWith(expect.anything(), "5547988887777@s.whatsapp.net", "Oi");
    expect(mockPrisma.message.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ organizationId: "org-1", contactId: "c1", direction: "out", connectionId: "wa1", status: "sent" }),
    });
    // atualiza o resumo da última mensagem do contato (usado pela lista de conversas)
    expect(mockPrisma.contact.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: "c1", organizationId: "org-1" }),
        data: { lastMessageAt: time, lastMessageText: "Oi", lastMessageDirection: "out" },
      })
    );
  });

  it("canal desconectado: 409 canal_desconectado", async () => {
    mockPrisma.contact.findFirst.mockResolvedValue({ id: "c1", name: "Maria", phone: "(47) 98888-7777", email: null });
    mockPrisma.connection.findMany.mockResolvedValue([{ ...wa, status: "DISCONNECTED" }]);
    const res = await send({ contactId: "c1", text: "Oi" });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("canal_desconectado");
    expect(mockPrisma.message.create).not.toHaveBeenCalled();
  });
});
