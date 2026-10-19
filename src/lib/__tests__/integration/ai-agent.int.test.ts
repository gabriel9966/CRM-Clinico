// Agente de IA contra Postgres real: a API da Anthropic é trocada por uma falsa
// e o envio ao canal é mockado. Só roda com TEST_DATABASE_URL.
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import type { ApiResponse, MessagesApi } from "@/lib/ai/loop";

const url = process.env.TEST_DATABASE_URL;

const sendContactMessage = vi.fn();
vi.mock("@/lib/messaging", () => ({ sendContactMessage: (...args: unknown[]) => sendContactMessage(...args) }));
vi.mock("@/lib/providers/google-calendar", () => ({
  createCalendarEvent: vi.fn(),
  updateCalendarEvent: vi.fn().mockResolvedValue(undefined),
  deleteCalendarEvent: vi.fn().mockResolvedValue(undefined),
}));

const usage = { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 0 };
const say = (t: string): ApiResponse => ({ content: [{ type: "text", text: t }], stop_reason: "end_turn", usage });
const tool = (id: string, name: string, input: unknown): ApiResponse => ({ content: [{ type: "tool_use", id, name, input }], stop_reason: "tool_use", usage });

describe.skipIf(!url)("agente de IA (Postgres real)", () => {
  let prisma: typeof import("@/lib/prisma").prismaRaw;
  let db: typeof import("@/lib/prisma").prisma;
  let agentMod: typeof import("@/lib/ai/agent");
  let messages: typeof import("@/lib/messages");
  let encryptJson: typeof import("@/lib/crypto").encryptJson;
  let orgId: string;
  let otherOrgId: string;
  let connectionId: string;
  let seq = 0;

  type Fixture = { contactId: string; conversationId: string; agentId: string };

  async function fixture(opts: { tools?: string[]; replyLimitPerHour?: number; enabled?: boolean } = {}): Promise<Fixture> {
    seq += 1;
    const contact = await prisma.contact.create({ data: { organizationId: orgId, name: `Marina Souza ${seq}`, phone: `1199999${String(1000 + seq)}` } });
    const agent = await prisma.aiAgent.create({
      data: {
        organizationId: orgId,
        name: "Atendente",
        enabled: opts.enabled ?? true,
        apiKey: encryptJson("sk-ant-chave-secreta-9999"),
        apiKeyHint: "9999",
        systemPrompt: "Clínica de teste.",
        tools: JSON.stringify(opts.tools ?? ["list_procedures", "cancel_appointment", "get_contact"]),
        replyLimitPerHour: opts.replyLimitPerHour ?? 20,
      },
    });
    const inbound = await messages.createMessage(db, { organizationId: orgId, contactId: contact.id, direction: "in", text: "Oi, quero saber os preços", connectionId });
    return { contactId: contact.id, conversationId: inbound.conversationId!, agentId: agent.id };
  }

  const run = (f: Fixture) => agentMod.respondWithAgent({ organizationId: orgId, contactId: f.contactId, agentId: f.agentId });
  const useApi = (...responses: (ApiResponse | (() => Promise<ApiResponse>))[]) => {
    const create = vi.fn<MessagesApi["create"]>();
    for (const r of responses) create.mockImplementationOnce(async () => (typeof r === "function" ? r() : r));
    agentMod.deps.createApi = () => ({ create });
    return create;
  };

  beforeAll(async () => {
    process.env.DATABASE_URL = url!;
    ({ prismaRaw: prisma, prisma: db } = await import("@/lib/prisma"));
    agentMod = await import("@/lib/ai/agent");
    messages = await import("@/lib/messages");
    ({ encryptJson } = await import("@/lib/crypto"));
    const tag = Date.now().toString(36);
    orgId = (await prisma.organization.create({ data: { name: "Clínica IA", slug: `ia-${tag}` } })).id;
    otherOrgId = (await prisma.organization.create({ data: { name: "Outra", slug: `oia-${tag}` } })).id;
    connectionId = (await prisma.connection.create({ data: { organizationId: orgId, provider: "WHATSAPP_EVOLUTION", label: "WhatsApp principal", status: "CONNECTED" } })).id;
  });

  afterAll(async () => {
    await prisma.organization.deleteMany({ where: { id: { in: [orgId, otherOrgId] } } });
    await prisma.$disconnect();
  });

  beforeEach(() => {
    sendContactMessage.mockReset();
    sendContactMessage.mockResolvedValue({ ok: true, status: "sent", messageId: "m1", connectionId });
  });

  it("responde pelo MESMO canal da conversa e registra o uso", async () => {
    const f = await fixture();
    const create = useApi(say("Olá, Marina! Posso ajudar com preços e horários."));
    const result = await run(f);
    expect(result).toMatchObject({ status: "replied", steps: 1, tokens: 120 });
    expect(create).toHaveBeenCalledTimes(1);
    expect(sendContactMessage).toHaveBeenCalledWith(orgId, f.contactId, "Olá, Marina! Posso ajudar com preços e horários.", { connectionId });
    const usageRow = await prisma.aiUsage.findFirstOrThrow({ where: { contactId: f.contactId } });
    expect(usageRow).toMatchObject({ outcome: "replied", inputTokens: 100, outputTokens: 20 });
    // o histórico enviado ao modelo é só desta conversa, com a mensagem do cliente
    expect(create.mock.calls[0][0].messages).toEqual([{ role: "user", content: "Oi, quero saber os preços" }]);
  });

  it("a chave nunca vai em log, no corpo nem volta: só o final fica como dica", async () => {
    const f = await fixture();
    const agent = await prisma.aiAgent.findUniqueOrThrow({ where: { id: f.agentId } });
    expect(agent.apiKey).not.toContain("sk-ant");
    expect(agent.apiKeyHint).toBe("9999");
  });

  it("não responde quando a IA está pausada na conversa nem quando o agente está desativado", async () => {
    const paused = await fixture();
    await prisma.conversation.update({ where: { id: paused.conversationId }, data: { aiPausedAt: new Date() } });
    const create = useApi(say("não deveria"));
    expect(await run(paused)).toMatchObject({ status: "skipped" });
    const off = await fixture({ enabled: false });
    expect(await run(off)).toMatchObject({ status: "skipped", reason: expect.stringContaining("desativado") });
    expect(create).not.toHaveBeenCalled();
    expect(sendContactMessage).not.toHaveBeenCalled();
  });

  it("segurança: cancelar agendamento de OUTRO cliente é recusado e nada é cancelado", async () => {
    const f = await fixture();
    const other = await prisma.contact.create({ data: { organizationId: orgId, name: "Outro Cliente", phone: "11988880000" } });
    const appointment = await prisma.appointment.create({
      data: { organizationId: orgId, contactId: other.id, title: "Limpeza", startAt: new Date(Date.now() + 5 * 86_400_000), endAt: new Date(Date.now() + 5 * 86_400_000 + 3_600_000) },
    });
    const create = useApi(tool("t1", "cancel_appointment", { appointmentId: appointment.id }), say("Não encontrei esse agendamento no seu cadastro."));
    const result = await run(f);
    expect(result.status).toBe("replied");
    const toolResult = (create.mock.calls[1][0].messages as { content: { content?: string; is_error?: boolean }[] }[])[2].content[0];
    expect(toolResult.is_error).toBe(true);
    expect(toolResult.content).toContain("agendamento_nao_encontrado");
    expect((await prisma.appointment.findUniqueOrThrow({ where: { id: appointment.id } })).status).toBe("SCHEDULED");
  });

  it("cancela o agendamento do PRÓPRIO cliente quando a ferramenta está liberada", async () => {
    const f = await fixture();
    const appointment = await prisma.appointment.create({
      data: { organizationId: orgId, contactId: f.contactId, title: "Botox", startAt: new Date(Date.now() + 5 * 86_400_000), endAt: new Date(Date.now() + 5 * 86_400_000 + 3_600_000) },
    });
    useApi(tool("t1", "cancel_appointment", { appointmentId: appointment.id, reason: "viagem" }), say("Cancelado."));
    await run(f);
    expect((await prisma.appointment.findUniqueOrThrow({ where: { id: appointment.id } })).status).toBe("CANCELLED");
  });

  it("ferramenta não liberada no agente não executa", async () => {
    const f = await fixture({ tools: ["list_procedures"] });
    const appointment = await prisma.appointment.create({
      data: { organizationId: orgId, contactId: f.contactId, title: "X", startAt: new Date(Date.now() + 5 * 86_400_000), endAt: new Date(Date.now() + 5 * 86_400_000 + 3_600_000) },
    });
    const create = useApi(tool("t1", "cancel_appointment", { appointmentId: appointment.id }), say("Vou chamar alguém."));
    await run(f);
    const toolResult = (create.mock.calls[1][0].messages as { content: { content?: string }[] }[])[2].content[0];
    expect(toolResult.content).toContain("ferramenta_indisponivel");
    expect((await prisma.appointment.findUniqueOrThrow({ where: { id: appointment.id } })).status).toBe("SCHEDULED");
  });

  it("não vaza dados de outra empresa: o catálogo vem só da empresa da conversa", async () => {
    const f = await fixture({ tools: ["list_procedures"] });
    await prisma.procedure.create({ data: { organizationId: orgId, name: "Peeling", priceCents: 25000 } });
    await prisma.procedure.create({ data: { organizationId: otherOrgId, name: "SEGREDO-OUTRA-EMPRESA", priceCents: 1 } });
    const create = useApi(tool("t1", "list_procedures", {}), say("Temos peeling."));
    await run(f);
    const toolResult = (create.mock.calls[1][0].messages as { content: { content: string }[] }[])[2].content[0].content;
    expect(toolResult).toContain("Peeling");
    expect(toolResult).toContain("R$ 250,00");
    expect(toolResult).not.toContain("SEGREDO");
  });

  it("passar para humano: envia a despedida, pausa a IA, cria tarefa e a próxima mensagem não é respondida", async () => {
    const f = await fixture();
    useApi(tool("t1", "handoff_to_human", { reason: "Cliente relata reação alérgica" }), say("Vou chamar uma atendente agora."));
    const result = await run(f);
    expect(result.status).toBe("handoff");
    expect(sendContactMessage).toHaveBeenCalledWith(orgId, f.contactId, "Vou chamar uma atendente agora.", { connectionId });
    expect((await prisma.conversation.findUniqueOrThrow({ where: { id: f.conversationId } })).aiPausedAt).not.toBeNull();
    const task = await prisma.activity.findFirstOrThrow({ where: { contactId: f.contactId } });
    expect(task.notes).toContain("reação alérgica");

    await messages.createMessage(db, { organizationId: orgId, contactId: f.contactId, direction: "in", text: "alô?", connectionId });
    const create = useApi(say("não deveria"));
    expect(await run(f)).toMatchObject({ status: "skipped" });
    expect(create).not.toHaveBeenCalled();
  });

  it("um atendente que responde pelo CRM pausa a IA automaticamente", async () => {
    const f = await fixture();
    const user = await prisma.user.create({ data: { organizationId: orgId, name: "Ana", email: `ana-${seq}-${Date.now()}@teste.com`, passwordHash: "x", role: "MEMBER" } });
    await messages.createMessage(db, { organizationId: orgId, contactId: f.contactId, direction: "out", text: "Oi, aqui é a Ana", senderId: user.id, connectionId });
    expect((await prisma.conversation.findUniqueOrThrow({ where: { id: f.conversationId } })).aiPausedAt).not.toBeNull();
    // resposta automática (sem senderId) NÃO pausa
    const g = await fixture();
    await messages.createMessage(db, { organizationId: orgId, contactId: g.contactId, direction: "out", text: "resposta do robô", connectionId });
    expect((await prisma.conversation.findUniqueOrThrow({ where: { id: g.conversationId } })).aiPausedAt).toBeNull();
  });

  it("descarta a resposta se um atendente assumiu enquanto a IA pensava", async () => {
    const f = await fixture();
    const user = await prisma.user.create({ data: { organizationId: orgId, name: "Bia", email: `bia-${seq}-${Date.now()}@teste.com`, passwordHash: "x", role: "MEMBER" } });
    useApi(async () => {
      await messages.createMessage(db, { organizationId: orgId, contactId: f.contactId, direction: "out", text: "Já cuido daqui!", senderId: user.id, connectionId });
      return say("resposta atrasada da IA");
    });
    const result = await run(f);
    expect(result.status).toBe("skipped");
    expect(sendContactMessage).not.toHaveBeenCalled();
  });

  it("chegou mensagem nova durante a resposta: descarta a velha e responde de novo com o histórico completo", async () => {
    const f = await fixture();
    await new Promise((r) => setTimeout(r, 5));
    const create = useApi(
      async () => {
        await messages.createMessage(db, { organizationId: orgId, contactId: f.contactId, direction: "in", text: "ah, e é para sexta", connectionId });
        return say("resposta sobre a primeira mensagem");
      },
      say("Entendi: preços e sexta.")
    );
    const result = await run(f);
    expect(result.status).toBe("replied");
    expect(create).toHaveBeenCalledTimes(2);
    expect(sendContactMessage).toHaveBeenCalledTimes(1);
    expect(sendContactMessage.mock.calls[0][2]).toBe("Entendi: preços e sexta.");
    expect((create.mock.calls[1][0].messages as { content: string }[])[0].content).toContain("ah, e é para sexta");
  });

  it("limite de respostas por hora: passa para a equipe e não responde (evita laço bot × bot)", async () => {
    const f = await fixture({ replyLimitPerHour: 1 });
    await prisma.aiUsage.create({ data: { organizationId: orgId, agentId: f.agentId, contactId: f.contactId, outcome: "replied" } });
    const create = useApi(say("não deveria"));
    const result = await run(f);
    expect(result.status).toBe("skipped");
    expect(create).not.toHaveBeenCalled();
    expect((await prisma.conversation.findUniqueOrThrow({ where: { id: f.conversationId } })).aiPausedAt).not.toBeNull();
    expect(await prisma.activity.count({ where: { contactId: f.contactId } })).toBe(1);
  });

  it("falha da API (chave inválida etc.): avisa o cliente uma vez, abre tarefa, pausa a IA e guarda o erro sem vazar a chave", async () => {
    const f = await fixture();
    agentMod.deps.createApi = () => ({ create: async () => { throw new Error("401 sk-ant-chave-secreta-9999 inválida"); } });
    const result = await run(f);
    expect(result.status).toBe("error");
    expect(sendContactMessage).toHaveBeenCalledTimes(1); // mensagem de transferência
    expect(sendContactMessage.mock.calls[0][2]).toContain("atendente");
    expect((await prisma.conversation.findUniqueOrThrow({ where: { id: f.conversationId } })).aiPausedAt).not.toBeNull();
    const agent = await prisma.aiAgent.findUniqueOrThrow({ where: { id: f.agentId } });
    expect(agent.lastError).toBeTruthy();
    expect(JSON.stringify(agent)).not.toContain("sk-ant-chave-secreta");
    expect(result.reason ?? "").not.toContain("sk-ant");
  });

  it("modo de teste (playground) não envia mensagens e não grava na agenda", async () => {
    const f = await fixture({ tools: ["list_procedures", "cancel_appointment"] });
    const create = useApi(tool("t1", "handoff_to_human", { reason: "teste" }), say("Chamando alguém."));
    const result = await agentMod.runAgentTest({ organizationId: orgId, agentId: f.agentId, turns: [{ role: "user", content: "quero falar com uma pessoa" }] });
    expect(result).toMatchObject({ ok: true, handoffReason: "teste" });
    expect(create).toHaveBeenCalled();
    expect(sendContactMessage).not.toHaveBeenCalled();
    expect(await prisma.activity.count({ where: { contactId: f.contactId } })).toBe(0);
    expect((await prisma.conversation.findUniqueOrThrow({ where: { id: f.conversationId } })).aiPausedAt).toBeNull();
  });

  it("agente de outra empresa não é encontrado", async () => {
    const f = await fixture();
    const result = await agentMod.respondWithAgent({ organizationId: otherOrgId, contactId: f.contactId, agentId: f.agentId });
    expect(result.status).toBe("skipped");
  });
});
