import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockPrisma } from "../../../test/mock-prisma";

const mockPrisma = createMockPrisma();
vi.mock("../prisma", () => ({ prisma: mockPrisma }));
vi.mock("../crypto", () => ({ decryptJson: vi.fn(() => ({ baseUrl: "http://evo", apiKey: "k", instanceName: "i" })) }));
vi.mock("../providers/evolution", () => ({ sendText: vi.fn() }));
vi.mock("../providers/instagram", () => ({ sendText: vi.fn() }));
vi.mock("../providers/email", () => ({ sendText: vi.fn() }));
vi.mock("../providers/whatsapp-cloud", () => ({ sendText: vi.fn(), sendTemplate: vi.fn() }));

const { decryptJson } = await import("../crypto");
const evolution = await import("../providers/evolution");
const instagram = await import("../providers/instagram");
const whatsappCloud = await import("../providers/whatsapp-cloud");
const { sendContactMessage, getSendOptions, whatsappNumber } = await import("../messaging");

const ORG = "org-1";
const CONTACT = { id: "c1", name: "Maria", phone: "(47) 98888-7777", email: "maria@x.com" };
const NOW = new Date("2030-01-01T12:00:00Z");

const conn = (id: string, provider: string, status = "CONNECTED", label = id) => ({ id, provider, status, label, config: "x" });
const channel = (connection: ReturnType<typeof conn>, externalId: string) => ({
  id: `ch-${connection.id}`,
  contactId: "c1",
  connectionId: connection.id,
  externalId,
  connection,
});

function setup(over: { contact?: unknown; channels?: unknown[]; connections?: unknown[] } = {}) {
  mockPrisma.contact.findFirst.mockResolvedValue("contact" in over ? over.contact : CONTACT);
  mockPrisma.contactChannel.findMany.mockResolvedValue(over.channels ?? []);
  mockPrisma.connection.findMany.mockResolvedValue(over.connections ?? []);
  mockPrisma.connection.findUniqueOrThrow.mockImplementation(async ({ where }: { where: { id: string } }) => {
    const all = [...(over.connections ?? []), ...(over.channels ?? []).map((c) => (c as { connection: unknown }).connection)] as { id: string }[];
    return all.find((c) => c.id === where.id);
  });
  mockPrisma.contactChannel.create.mockResolvedValue({});
  mockPrisma.message.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: "m1", time: NOW, ...data }));
  mockPrisma.contact.updateMany.mockResolvedValue({ count: 1 });
  mockPrisma.conversation.findFirst.mockResolvedValue({ id: "cv-1" });
  mockPrisma.conversation.updateMany.mockResolvedValue({ count: 1 });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(decryptJson).mockReturnValue({ baseUrl: "http://evo", apiKey: "k", instanceName: "i" });
});

describe("whatsappNumber", () => {
  it("acrescenta o DDI do Brasil a número sem DDI e mantém quem já tem", () => {
    expect(whatsappNumber("(47) 98888-7777")).toBe("5547988887777");
    expect(whatsappNumber("4733334444")).toBe("554733334444");
    expect(whatsappNumber("+55 47 98888-7777")).toBe("5547988887777");
    expect(whatsappNumber("123")).toBeNull();
  });
});

describe("sendContactMessage — toda mensagem sai por um canal real", () => {
  it("SEM canal: recusa e NÃO grava nada (antes gravava como 'enviada')", async () => {
    setup({ contact: { ...CONTACT, phone: null, email: null } });
    const r = await sendContactMessage(ORG, "c1", "Oi");
    expect(r).toMatchObject({ ok: false, code: "sem_canal" });
    expect(mockPrisma.message.create).not.toHaveBeenCalled();
    expect(evolution.sendText).not.toHaveBeenCalled();
  });

  it("envia pelo canal já existente do contato e registra com a conexão", async () => {
    const wa = conn("wa1", "WHATSAPP_EVOLUTION");
    setup({ channels: [channel(wa, "5547988887777@s.whatsapp.net")], connections: [wa] });
    const r = await sendContactMessage(ORG, "c1", "  Olá!  ", { senderId: "u1" });
    expect(r).toMatchObject({ ok: true, status: "sent", connectionId: "wa1" });
    expect(evolution.sendText).toHaveBeenCalledWith(expect.anything(), "5547988887777@s.whatsapp.net", "Olá!");
    expect(mockPrisma.message.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ direction: "out", text: "Olá!", connectionId: "wa1", status: "sent", senderId: "u1" }),
    });
  });

  it("canal desconectado: recusa sem gravar", async () => {
    const wa = conn("wa1", "WHATSAPP_EVOLUTION", "DISCONNECTED");
    setup({ channels: [channel(wa, "5547988887777@s.whatsapp.net")], connections: [wa] });
    const r = await sendContactMessage(ORG, "c1", "Oi");
    expect(r).toMatchObject({ ok: false, code: "canal_desconectado" });
    expect(mockPrisma.message.create).not.toHaveBeenCalled();
  });

  it("API oficial bloqueia texto livre sem mensagem recebida nas últimas 24 horas", async () => {
    const wa = conn("cloud-1", "WHATSAPP_CLOUD");
    setup({ channels: [channel(wa, "5547988887777")], connections: [wa] });
    mockPrisma.message.findFirst.mockResolvedValue(null);
    expect(await sendContactMessage(ORG, "c1", "Oi")).toMatchObject({ ok: false, code: "janela_24h_encerrada" });
    expect(whatsappCloud.sendText).not.toHaveBeenCalled();
    expect(mockPrisma.message.create).not.toHaveBeenCalled();
  });

  it("API oficial permite texto livre com resposta recente do cliente na mesma instância", async () => {
    const wa = conn("cloud-1", "WHATSAPP_CLOUD");
    setup({ channels: [channel(wa, "5547988887777")], connections: [wa] });
    mockPrisma.message.findFirst.mockResolvedValue({ time: new Date(Date.now() - 60_000) });
    expect(await sendContactMessage(ORG, "c1", "Oi")).toMatchObject({ ok: true, status: "sent" });
    expect(mockPrisma.message.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ connectionId: "cloud-1", direction: "in" }) }));
    expect(whatsappCloud.sendText).toHaveBeenCalled();
  });

  it("API oficial encerra a janela após 24 horas da última mensagem do cliente", async () => {
    const wa = conn("cloud-1", "WHATSAPP_CLOUD");
    setup({ channels: [channel(wa, "5547988887777")], connections: [wa] });
    mockPrisma.message.findFirst.mockResolvedValue({ time: new Date(Date.now() - 24 * 60 * 60 * 1000 - 1000) });
    expect(await sendContactMessage(ORG, "c1", "Oi")).toMatchObject({ ok: false, code: "janela_24h_encerrada" });
    expect(whatsappCloud.sendText).not.toHaveBeenCalled();
  });

  it("provedor recusou o envio: registra como 'failed' (visível) e informa o motivo", async () => {
    const wa = conn("wa1", "WHATSAPP_EVOLUTION");
    setup({ channels: [channel(wa, "5547988887777@s.whatsapp.net")], connections: [wa] });
    vi.mocked(evolution.sendText).mockRejectedValue(new Error("número não existe no WhatsApp"));
    const r = await sendContactMessage(ORG, "c1", "Oi");
    expect(r).toMatchObject({ ok: true, status: "failed", error: "número não existe no WhatsApp" });
    expect(mockPrisma.message.create).toHaveBeenCalledWith({ data: expect.objectContaining({ status: "failed" }) });
  });

  it("primeira conversa: contato com telefone e UMA conexão WhatsApp conectada → cria o vínculo e envia", async () => {
    const wa = conn("wa1", "WHATSAPP_EVOLUTION");
    setup({ channels: [], connections: [wa] });
    const r = await sendContactMessage(ORG, "c1", "Olá, tudo bem?");
    expect(r).toMatchObject({ ok: true, status: "sent", connectionId: "wa1" });
    expect(mockPrisma.contactChannel.create).toHaveBeenCalledWith({
      data: { contactId: "c1", connectionId: "wa1", externalId: "5547988887777@s.whatsapp.net", externalName: "Maria" },
    });
    expect(evolution.sendText).toHaveBeenCalledWith(expect.anything(), "5547988887777@s.whatsapp.net", "Olá, tudo bem?");
  });

  it("mais de um canal possível e nenhum escolhido: pede para escolher (não adivinha)", async () => {
    setup({ channels: [], connections: [conn("wa1", "WHATSAPP_EVOLUTION"), conn("wa2", "WHATSAPP_EVOLUTION")] });
    const r = await sendContactMessage(ORG, "c1", "Oi");
    expect(r).toMatchObject({ ok: false, code: "escolha_canal" });
    expect(mockPrisma.message.create).not.toHaveBeenCalled();
    // escolhendo explicitamente, envia
    const ok = await sendContactMessage(ORG, "c1", "Oi", { connectionId: "wa2" });
    expect(ok).toMatchObject({ ok: true, connectionId: "wa2" });
  });

  it("com Instagram e WhatsApp já existentes usa o mais recente, ou o escolhido", async () => {
    const ig = conn("ig1", "INSTAGRAM");
    const wa = conn("wa1", "WHATSAPP_EVOLUTION");
    setup({ channels: [channel(ig, "igsid-1"), channel(wa, "5547988887777@s.whatsapp.net")], connections: [ig, wa] });
    const first = await sendContactMessage(ORG, "c1", "Oi");
    expect(first).toMatchObject({ ok: true, connectionId: "ig1" }); // primeiro da lista (mais recente)
    expect(instagram.sendText).toHaveBeenCalledWith(expect.anything(), "igsid-1", "Oi");
    const chosen = await sendContactMessage(ORG, "c1", "Oi", { connectionId: "wa1" });
    expect(chosen).toMatchObject({ ok: true, connectionId: "wa1" });
  });

  it("Instagram não pode ser INICIADO pelo CRM (precisa que a pessoa escreva primeiro)", async () => {
    setup({ contact: { ...CONTACT, phone: null, email: null }, channels: [], connections: [conn("ig1", "INSTAGRAM")] });
    const r = await sendContactMessage(ORG, "c1", "Oi");
    expect(r).toMatchObject({ ok: false, code: "sem_canal" });
  });

  it("canal escolhido que não é deste contato/organização é recusado", async () => {
    setup({ channels: [], connections: [conn("wa1", "WHATSAPP_EVOLUTION")] });
    const r = await sendContactMessage(ORG, "c1", "Oi", { connectionId: "conexao-de-outra-org" });
    expect(r).toMatchObject({ ok: false, code: "canal_invalido" });
    expect(mockPrisma.message.create).not.toHaveBeenCalled();
  });

  it("telefone que já pertence a outro contato nesse canal: recusa (não rouba a conversa)", async () => {
    setup({ channels: [], connections: [conn("wa1", "WHATSAPP_EVOLUTION")] });
    mockPrisma.contactChannel.create.mockRejectedValue(Object.assign(new Error("unique"), { code: "P2002" }));
    const r = await sendContactMessage(ORG, "c1", "Oi");
    expect(r).toMatchObject({ ok: false, code: "canal_em_uso" });
    expect(mockPrisma.message.create).not.toHaveBeenCalled();
  });

  it("texto vazio e contato de outra organização", async () => {
    setup();
    expect(await sendContactMessage(ORG, "c1", "   ")).toMatchObject({ ok: false, code: "texto_vazio" });
    setup({ contact: null });
    expect(await sendContactMessage(ORG, "x", "Oi")).toMatchObject({ ok: false, code: "contato_nao_encontrado" });
    expect(mockPrisma.contact.findFirst).toHaveBeenLastCalledWith(expect.objectContaining({ where: { id: "x", organizationId: ORG } }));
  });
});

describe("getSendOptions", () => {
  it("template oficial funciona sem janela aberta e registra o id do provedor", async () => {
    const wa = conn("cloud-1", "WHATSAPP_CLOUD");
    setup({ channels: [channel(wa, "5547988887777")], connections: [wa] });
    mockPrisma.messageTemplate.findFirst.mockResolvedValue({ id: "t1", cloudTemplateName: "hello", cloudLanguage: "pt_BR", body: "Olá {{1}}" });
    vi.mocked(whatsappCloud.sendTemplate).mockResolvedValue({ messages: [{ id: "wamid.123" }] });
    const result = await sendContactMessage(ORG, "c1", "", { connectionId: "cloud-1", templateId: "t1", templateParameters: ["Maria"] });
    expect(result).toMatchObject({ ok: true, status: "sent" });
    expect(whatsappCloud.sendTemplate).toHaveBeenCalledWith(expect.anything(), "5547988887777", "hello", "pt_BR", ["Maria"]);
    expect(mockPrisma.message.create).toHaveBeenCalledWith({ data: expect.objectContaining({ text: "Olá Maria", externalMessageId: "wamid.123" }) });
  });
  it("template de outra organização ou parâmetro ausente é recusado antes do envio", async () => {
    const wa = conn("cloud-1", "WHATSAPP_CLOUD");
    setup({ channels: [channel(wa, "5547988887777")], connections: [wa] });
    mockPrisma.messageTemplate.findFirst.mockResolvedValue(null);
    expect(await sendContactMessage(ORG, "c1", "", { templateId: "outro" })).toMatchObject({ ok: false });
    mockPrisma.messageTemplate.findFirst.mockResolvedValue({ cloudTemplateName: "hello", body: "Olá {{1}}" });
    expect(await sendContactMessage(ORG, "c1", "", { templateId: "t1", templateParameters: [] })).toMatchObject({ ok: false });
    expect(whatsappCloud.sendTemplate).not.toHaveBeenCalled();
  });
  it("lista canais existentes e os que podem ser iniciados, marcando desconectados", async () => {
    const ig = conn("ig1", "INSTAGRAM", "DISCONNECTED", "Insta clínica");
    const wa = conn("wa1", "WHATSAPP_EVOLUTION", "CONNECTED", "Recepção");
    setup({ channels: [channel(ig, "igsid-1")], connections: [ig, wa] });
    const opts = await getSendOptions(ORG, "c1");
    expect(opts).toEqual([
      { connectionId: "ig1", provider: "INSTAGRAM", label: "Insta clínica", connected: false, existing: true },
      { connectionId: "wa1", provider: "WHATSAPP_EVOLUTION", label: "Recepção", connected: true, existing: false },
    ]);
  });

  it("contato de outra organização não tem opções", async () => {
    setup({ contact: null });
    expect(await getSendOptions(ORG, "x")).toEqual([]);
  });
});
