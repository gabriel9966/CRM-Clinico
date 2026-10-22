// Validação ponta a ponta de automações, integrações (webhooks de canal) e MCP
// contra um Postgres REAL. Chama as rotas como o provedor chamaria.
//   TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54329/crm npx vitest run src/lib/__tests__/integration
import { createHmac } from "node:crypto";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { NextRequest } from "next/server";

const url = process.env.TEST_DATABASE_URL;

type Flow = { nodes: unknown[]; edges: unknown[] };
const trigger = { id: "t", type: "triggerNode", position: { x: 0, y: 0 }, data: { kind: "trigger", label: "t" } };
const action = (id: string, actionType: string, config: Record<string, unknown>) => ({ id, type: "actionNode", position: { x: 0, y: 0 }, data: { kind: "action", actionType, config } });
const chain = (...ids: string[]) => ids.slice(1).map((target, i) => ({ id: `e${i}`, source: ids[i], target }));

describe.skipIf(!url)("automações, integrações e MCP (PostgreSQL real)", () => {
  let db: typeof import("@/lib/prisma").prismaRaw;
  let org: string;
  let owner: string;
  let connection: string;
  let pipeline: string;
  let stageA: string;
  let stageB: string;
  let token: (kind: "evolution" | "automation", id: string) => string;

  async function automation(trig: string, flow: Flow, triggerConfig: Record<string, unknown> = {}) {
    return (await db.automation.create({ data: { organizationId: org, name: trig, trigger: trig as never, enabled: true, flow: JSON.stringify(flow), triggerConfig: JSON.stringify(triggerConfig) } })).id;
  }
  const runsOf = (automationId: string) => db.automationRun.findMany({ where: { automationId }, orderBy: { startedAt: "asc" } });

  async function evolution(body: unknown) {
    const { POST } = await import("@/app/api/webhooks/evolution/[connectionId]/route");
    const req = new NextRequest(`http://localhost/api/webhooks/evolution/${connection}?token=${token("evolution", connection)}`, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json", "x-forwarded-for": `10.0.0.${Math.floor(Math.random() * 200)}` } });
    return (await POST(req, { params: Promise.resolve({ connectionId: connection }) })).json();
  }
  const goMessage = (id: string, chat: string, text: string, extra: Record<string, unknown> = {}) => ({
    event: "Message",
    data: { Info: { ID: id, Chat: chat, Sender: chat, IsFromMe: false, PushName: "Paciente", Timestamp: new Date().toISOString(), ...extra }, Message: { conversation: text } },
  });

  async function mcp(apiKey: string, name: string, args: Record<string, unknown> = {}) {
    const { POST } = await import("@/app/api/mcp/route");
    const req = new NextRequest("http://localhost/api/mcp", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
    });
    const res = await POST(req);
    if (res.status !== 200) return { status: res.status };
    const raw = await res.text();
    const json = JSON.parse(raw.includes("data:") ? raw.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5)).join("") : raw);
    const result = json.result;
    return { status: 200, isError: Boolean(result?.isError), data: result?.content?.[0]?.text ? JSON.parse(result.content[0].text) : null };
  }

  beforeAll(async () => {
    process.env.DATABASE_URL = url!;
    process.env.WEBHOOK_REQUIRE_TOKEN = "true";
    ({ prismaRaw: db } = await import("@/lib/prisma"));
    ({ webhookToken: token } = await import("@/lib/webhook-auth"));
    org = (await db.organization.create({ data: { name: "Validação de módulos", slug: `modules-${Date.now()}` } })).id;
    owner = (await db.user.create({ data: { organizationId: org, name: "Dona", email: `owner-${org}@test.local`, passwordHash: "x" } })).id;
    connection = (await db.connection.create({ data: { organizationId: org, label: "WhatsApp", provider: "WHATSAPP_EVOLUTION", status: "CONNECTED" } })).id;
    pipeline = (await db.pipeline.create({ data: { organizationId: org, name: "Vendas" } })).id;
    stageA = (await db.stage.create({ data: { pipelineId: pipeline, label: "Novo", color: "#111111", order: 0 } })).id;
    stageB = (await db.stage.create({ data: { pipelineId: pipeline, label: "Avaliação", color: "#111111", order: 1 } })).id;
  });

  afterAll(async () => {
    if (org) await db.organization.delete({ where: { id: org } });
    await db?.$disconnect();
  });

  describe("webhook da Evolution", () => {
    it("reconhece contato cadastrado com outra formatação e não duplica", async () => {
      const existing = await db.contact.create({ data: { organizationId: org, name: "Já cadastrada", phone: "(15) 99165-2134", ownerId: owner } });
      const res = await evolution(goMessage("A1", "5515991652134@s.whatsapp.net", "Bom dia"));
      expect(res).toMatchObject({ ok: true, duplicate: false });
      expect(await db.contact.count({ where: { organizationId: org, deletedAt: null } })).toBe(1);
      expect(await db.message.count({ where: { contactId: existing.id, direction: "in" } })).toBe(1);
    });

    it("contato novo dispara 'Novo contato criado' e 'Mensagem recebida'; reenvio não duplica", async () => {
      const created = await automation("CONTACT_CREATED", { nodes: [trigger, action("a", "create_task", { title: "Primeiro contato", dueInDays: 0 })], edges: chain("t", "a") });
      const received = await automation("MESSAGE_RECEIVED", { nodes: [trigger, action("a", "add_tag", { tag: "respondeu" })], edges: chain("t", "a") });
      await db.user.update({ where: { id: owner }, data: { role: "ADMIN" } });
      await evolution(goMessage("B1", "5511977776666@s.whatsapp.net", "Quero agendar"));
      const again = await evolution(goMessage("B1", "5511977776666@s.whatsapp.net", "Quero agendar"));
      expect(again).toMatchObject({ duplicate: true });

      const contact = await db.contact.findFirstOrThrow({ where: { organizationId: org, phone: "+5511977776666" } });
      expect(await runsOf(created)).toHaveLength(1);
      expect(await runsOf(received)).toHaveLength(1);
      expect((await runsOf(received))[0].status).toBe("COMPLETED");
      expect(JSON.parse(contact.tags)).toContain("respondeu");
      const task = await db.activity.findFirstOrThrow({ where: { contactId: contact.id, title: "Primeiro contato" } });
      expect(task.assigneeId).toBe(contact.ownerId);
      await db.automation.deleteMany({ where: { id: { in: [created, received] } } });
    });

    it("aceita mensagem endereçada por LID e registra no log o que descartou", async () => {
      await evolution(goMessage("C1", "998877@lid", "Oi pelo LID", { SenderAlt: "5521966665555@s.whatsapp.net" }));
      expect(await db.contact.count({ where: { organizationId: org, phone: "+5521966665555" } })).toBe(1);

      const ignored = await evolution(goMessage("C2", "120363000@g.us", "Mensagem de grupo", { IsGroup: true }));
      expect(ignored).toMatchObject({ ignored: true });
      const log = await db.webhookLog.findFirstOrThrow({ where: { connectionId: connection, statusCode: 202 }, orderBy: { createdAt: "desc" } });
      expect(log.detail).toContain("grupo");
    });

    it("mensagens simultâneas de um número novo criam um só contato e um só atendimento", async () => {
      // 5 números x 5 mensagens ao mesmo tempo ("oi", "tudo bem?"...): antes
      // nascia contato duplicado, contato apagado em uso e atendimento em dobro.
      for (let n = 0; n < 5; n++) {
        const jid = `553195555${String(n).padStart(4, "0")}@s.whatsapp.net`;
        await Promise.all(Array.from({ length: 5 }, (_, k) => evolution(goMessage(`D${n}-${k}`, jid, `msg ${k}`))));
        const contacts = await db.contact.findMany({ where: { organizationId: org, phone: `+${jid.split("@")[0]}` } });
        expect(contacts).toHaveLength(1);
        expect(await db.conversation.count({ where: { contactId: contacts[0].id } })).toBe(1);
        expect(await db.message.count({ where: { contactId: contacts[0].id } })).toBe(5);
      }
    });
  });

  describe("motor de automação", () => {
    it("'Contato sem interação' dispara uma vez por período de silêncio", async () => {
      const { processDueTriggerAutomations } = await import("@/lib/automation/engine");
      const old = new Date(Date.now() - 10 * 86_400_000);
      const quiet = await db.contact.create({ data: { organizationId: org, name: "Sumida", createdAt: old, lastMessageAt: old } });
      const id = await automation("CONTACT_INACTIVE", { nodes: [trigger, action("a", "add_tag", { tag: "reativar" })], edges: chain("t", "a") }, { inactivityDays: 3, repeatHours: 1 });
      const mine = async () => (await runsOf(id)).filter((r) => r.contactId === quiet.id);

      await processDueTriggerAutomations();
      expect(await mine()).toHaveLength(1);

      await db.automation.update({ where: { id }, data: { lastTriggeredAt: null } });
      await processDueTriggerAutomations();
      expect(await mine()).toHaveLength(1); // continua parada: não repete

      // linha do tempo: a automação rodou há 8 dias, a pessoa respondeu há 5 e
      // sumiu de novo — é um novo período de silêncio, dispara outra vez
      await db.automationRun.updateMany({ where: { automationId: id }, data: { startedAt: new Date(Date.now() - 8 * 86_400_000) } });
      await db.contact.update({ where: { id: quiet.id }, data: { lastMessageAt: new Date(Date.now() - 5 * 86_400_000) } });
      await db.automation.update({ where: { id }, data: { lastTriggeredAt: null } });
      await processDueTriggerAutomations();
      expect(await mine()).toHaveLength(2);
      await db.automation.update({ where: { id }, data: { enabled: false } });
    });

    it("webhook de automação entrega formulário (x-www-form-urlencoded) ao fluxo", async () => {
      const { POST } = await import("@/app/api/webhooks/automation/[automationId]/route");
      const id = await automation("WEBHOOK_RECEIVED", {
        nodes: [trigger, { id: "c", type: "conditionNode", position: { x: 0, y: 0 }, data: { kind: "condition", field: "payload_field", path: "origem", operator: "equals", value: "site" } }, action("a", "create_contact", { name: "{{payload.nome}}", phone: "{{payload.fone}}" })],
        edges: [{ id: "e0", source: "t", target: "c" }, { id: "e1", source: "c", target: "a", sourceHandle: "true" }],
      });
      const req = new NextRequest(`http://localhost/api/webhooks/automation/${id}?token=${token("automation", id)}`, { method: "POST", body: "nome=Lead+do+Site&fone=11912345678&origem=site", headers: { "content-type": "application/x-www-form-urlencoded" } });
      const res = await POST(req, { params: Promise.resolve({ automationId: id }) });
      expect(res.status).toBe(200);
      expect(await db.contact.count({ where: { organizationId: org, name: "Lead do Site" } })).toBe(1);

      const denied = await POST(new NextRequest(`http://localhost/api/webhooks/automation/${id}`, { method: "POST", body: "{}" }), { params: Promise.resolve({ automationId: id }) });
      expect(denied.status).toBe(401);
    });

    it("bloco de código enxerga a oportunidade mesmo fora das 100 mais recentes", async () => {
      const { runCode } = await import("@/lib/automation/sandbox");
      const contact = await db.contact.create({ data: { organizationId: org, name: "Antiga" } });
      const oldOpp = await db.opportunity.create({ data: { organizationId: org, pipelineId: pipeline, stageId: stageA, contactId: contact.id, title: "Negócio antigo", value: 10, createdAt: new Date("2020-01-01") } });
      await db.opportunity.createMany({ data: Array.from({ length: 101 }, (_, i) => ({ organizationId: org, pipelineId: pipeline, stageId: stageA, contactId: contact.id, title: `Recente ${i}`, value: 1 })) });
      const result = await runCode("return opportunity && opportunity.title;", { organizationId: org, opportunityId: oldOpp.id });
      expect(result).toMatchObject({ ok: true, result: "Negócio antigo" });
    });
  });

  describe("servidor MCP", () => {
    let apiKey: string;
    beforeAll(async () => {
      const { getOrCreateMcpApiKey } = await import("@/lib/mcp-config");
      apiKey = await getOrCreateMcpApiKey(org);
    });

    it("recusa chave inválida", async () => {
      expect((await mcp("mcp_chave_errada", "list_contacts")).status).toBe(401);
    });

    it("busca contatos sem diferenciar maiúsculas", async () => {
      const res = await mcp(apiKey, "list_contacts", { search: "SUMIDA" });
      expect(res.data.map((c: { name: string }) => c.name)).toContain("Sumida");
    });

    it("contato e negócio criados pelo MCP disparam as automações", async () => {
      const onContact = await automation("CONTACT_CREATED", { nodes: [trigger, action("a", "add_tag", { tag: "via-mcp" })], edges: chain("t", "a") });
      const onStage = await automation("STAGE_CHANGED", { nodes: [trigger, action("a", "add_tag", { tag: "avaliacao", target: "opportunity" })], edges: chain("t", "a") }, { pipelineId: pipeline, stageId: stageB });

      const contact = await mcp(apiKey, "create_contact", { name: "Lead do agente" });
      expect(contact.isError).toBe(false);
      expect(JSON.parse((await db.contact.findUniqueOrThrow({ where: { id: contact.data.id } })).tags)).toContain("via-mcp");

      const opp = await mcp(apiKey, "create_opportunity", { title: "Botox", contactId: contact.data.id, pipelineId: pipeline, stageId: stageA });
      const moved = await mcp(apiKey, "move_opportunity_stage", { opportunityId: opp.data.id, stageId: stageB });
      expect(moved).toMatchObject({ isError: false });
      expect(JSON.parse((await db.opportunity.findUniqueOrThrow({ where: { id: opp.data.id } })).tags)).toContain("avaliacao");
      expect(await runsOf(onStage)).toHaveLength(1);
      await db.automation.deleteMany({ where: { id: { in: [onContact, onStage] } } });
    });

    it("erro vira isError com código, sem vazar detalhes internos", async () => {
      const missing = await mcp(apiKey, "move_opportunity_stage", { opportunityId: "nao-existe", stageId: stageB });
      expect(missing).toMatchObject({ isError: true, data: { ok: false } });
      const foreign = await mcp(apiKey, "create_contact", { name: "X", ownerId: "usuario-de-outra-empresa" });
      expect(foreign).toMatchObject({ isError: true, data: { error: "responsavel_invalido" } });
      const noChannel = await mcp(apiKey, "send_message", { contactId: "nao-existe", text: "oi" });
      expect(noChannel).toMatchObject({ isError: true, data: { ok: false, code: "contato_nao_encontrado" } });
    });

    it("não enxerga dados de outra empresa", async () => {
      const other = await db.organization.create({ data: { name: "Outra", slug: `outra-${Date.now()}` } });
      try {
        const secret = await db.contact.create({ data: { organizationId: other.id, name: "Paciente sigilosa" } });
        expect((await mcp(apiKey, "list_contacts", { search: "sigilosa" })).data).toEqual([]);
        expect(await mcp(apiKey, "get_contact", { contactId: secret.id })).toMatchObject({ isError: true });
      } finally {
        await db.organization.delete({ where: { id: other.id } });
      }
    });
  });

  describe("webhook do Instagram", () => {
    it("reenvio da Meta com o mesmo mid não duplica mensagem nem automação", async () => {
      process.env.INSTAGRAM_APP_SECRET = "segredo-de-teste";
      const ig = await db.connection.create({ data: { organizationId: org, label: "Instagram", provider: "INSTAGRAM", status: "CONNECTED", config: (await import("@/lib/crypto")).encryptJson({ igUserId: "IG-PAGE-1" }) } });
      const received = await automation("MESSAGE_RECEIVED", { nodes: [trigger, action("a", "add_tag", { tag: "ig" })], edges: chain("t", "a") });
      const { POST } = await import("@/app/api/webhooks/instagram/route");
      const body = JSON.stringify({ entry: [{ messaging: [{ sender: { id: "IGSID-77" }, recipient: { id: "IG-PAGE-1" }, timestamp: Date.now(), message: { mid: "mid.1", text: "Oi" } }] }] });
      const signed = () => new NextRequest("http://localhost/api/webhooks/instagram", { method: "POST", body, headers: { "x-hub-signature-256": `sha256=${createHmac("sha256", "segredo-de-teste").update(body).digest("hex")}` } });
      expect((await POST(signed())).status).toBe(200);
      expect((await POST(signed())).status).toBe(200);
      expect(await db.message.count({ where: { connectionId: ig.id } })).toBe(1);
      expect(await runsOf(received)).toHaveLength(1);
      await db.automation.delete({ where: { id: received } });
    });
  });
});
