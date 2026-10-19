import { describe, it, expect, beforeAll, afterAll } from "vitest";

describe.skipIf(!process.env.TEST_DATABASE_URL)("permissões e etapas (PostgreSQL real)", () => {
  let db: typeof import("@/lib/prisma").prismaRaw;
  let org: string;
  let user: string;
  let contact: string;
  let visiblePipeline: string;
  let hiddenPipeline: string;
  let visibleConnection: string;
  let hiddenConnection: string;
  let openStage: string;
  let lostStage: string;
  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    ({ prismaRaw: db } = await import("@/lib/prisma"));
    org = (await db.organization.create({ data: { name: "Validação de segurança", slug: `security-${Date.now()}` } })).id;
    user = (await db.user.create({ data: { organizationId: org, name: "Restrito", email: `restricted-${org}@test.local`, passwordHash: "unused" } })).id;
    contact = (await db.contact.create({ data: { organizationId: org, name: "Contato", ownerId: user } })).id;
    visiblePipeline = (await db.pipeline.create({ data: { organizationId: org, name: "Permitido" } })).id;
    hiddenPipeline = (await db.pipeline.create({ data: { organizationId: org, name: "Restrito" } })).id;
    openStage = (await db.stage.create({ data: { pipelineId: visiblePipeline, label: "Entrada", color: "#123456", order: 0 } })).id;
    lostStage = (await db.stage.create({ data: { pipelineId: visiblePipeline, label: "Encerrada", color: "#123456", order: 1, status: "LOST" } })).id;
    const hiddenStage = await db.stage.create({ data: { pipelineId: hiddenPipeline, label: "Secreta", color: "#123456", order: 0 } });
    visibleConnection = (await db.connection.create({ data: { organizationId: org, label: "Permitida", provider: "WHATSAPP_EVOLUTION" } })).id;
    hiddenConnection = (await db.connection.create({ data: { organizationId: org, label: "Restrita", provider: "WHATSAPP_EVOLUTION" } })).id;
    await db.opportunity.create({ data: { organizationId: org, pipelineId: visiblePipeline, stageId: openStage, contactId: contact, title: "Visível", value: 100 } });
    await db.opportunity.create({ data: { organizationId: org, pipelineId: hiddenPipeline, stageId: hiddenStage.id, contactId: contact, title: "Oculto", value: 900 } });
    const { createMessage } = await import("@/lib/messages");
    await createMessage(db as never, { organizationId: org, contactId: contact, connectionId: visibleConnection, text: "Mensagem permitida", direction: "in" });
    await createMessage(db as never, { organizationId: org, contactId: contact, connectionId: hiddenConnection, text: "Mensagem restrita", direction: "in" });
  });
  afterAll(async () => { if (org) await db.organization.delete({ where: { id: org } }); await db?.$disconnect(); });
  it("novo usuário nasce sem acesso amplo", async () => {
    const account = await db.user.findUniqueOrThrow({ where: { id: user } });
    expect(account.accessConfigured).toBe(true);
    expect(account.permissions).toBe("[]");
  });
  it("a ficha do contato respeita pipelines e instâncias", async () => {
    const { getContactDetail } = await import("@/lib/queries");
    const detail = await getContactDetail(org, { id: user, role: "MEMBER", pipelineIds: [visiblePipeline], connectionIds: [visibleConnection], canReadMessages: true }, contact);
    expect(detail?.opportunities.map((item) => item.title)).toEqual(["Visível"]);
    expect(detail?.messages.map((item) => item.text)).toEqual(["Mensagem permitida"]);
  });
  it("dashboard não soma pipelines ou canais fora do escopo", async () => {
    const { getDashboardAggregates } = await import("@/lib/queries");
    const report = await getDashboardAggregates(org, { pipelineIds: [visiblePipeline], connectionIds: [visibleConnection], ownerId: user });
    expect(report.stageTotals.reduce((sum, item) => sum + item.sum, 0)).toBe(100);
    expect(report.channels.map((item) => item.connectionId)).toEqual([visibleConnection]);
    expect((await getDashboardAggregates(org, { pipelineIds: [], connectionIds: [] })).stageTotals).toEqual([]);
  });
  it("API/MCP bloqueia perda sem motivo e etapa de outro pipeline", async () => {
    const { mcpMoveOpportunityStage } = await import("@/lib/mcp-tools");
    const opportunity = await db.opportunity.findFirstOrThrow({ where: { organizationId: org, title: "Visível" } });
    await expect(mcpMoveOpportunityStage(org, opportunity.id, lostStage)).rejects.toThrow(/motivo/);
    const otherStage = await db.stage.findFirstOrThrow({ where: { pipelineId: hiddenPipeline } });
    expect(await mcpMoveOpportunityStage(org, opportunity.id, otherStage.id)).toMatchObject({ ok: false });
    expect((await db.opportunity.findUniqueOrThrow({ where: { id: opportunity.id } })).stageId).toBe(openStage);
  });
  it("criação e movimentação via MCP preservam o histórico", async () => {
    const { mcpCreateOpportunity, mcpMoveOpportunityStage } = await import("@/lib/mcp-tools");
    const next = await db.stage.create({ data: { pipelineId: visiblePipeline, label: "Próxima", color: "#123456", order: 2 } });
    const created = await mcpCreateOpportunity(org, { title: "Histórico", contactId: contact, pipelineId: visiblePipeline, stageId: openStage });
    if (!("id" in created)) throw new Error("Falha ao criar oportunidade");
    await mcpMoveOpportunityStage(org, created.id!, next.id);
    await mcpMoveOpportunityStage(org, created.id!, openStage);
    const history = await db.opportunityStageHistory.findMany({ where: { opportunityId: created.id }, orderBy: { enteredAt: "asc" } });
    expect(history.map((item) => item.stageId)).toEqual([openStage, next.id, openStage]);
    expect(history.filter((item) => item.exitedAt === null)).toHaveLength(1);
  });
});
