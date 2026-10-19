import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
const send = vi.hoisted(() => vi.fn());
vi.mock("@/lib/providers/evolution", () => ({ sendText: (...args: unknown[]) => send(...args) }));

describe.skipIf(!process.env.TEST_DATABASE_URL)("campanhas e concorrência (PostgreSQL real)", () => {
  let db: typeof import("@/lib/prisma").prismaRaw;
  let orgId: string;
  let connectionId: string;
  let processCampaign: typeof import("@/lib/campaigns").processCampaign;
  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    ({ prismaRaw: db } = await import("@/lib/prisma"));
    ({ processCampaign } = await import("@/lib/campaigns"));
    const { encryptJson } = await import("@/lib/crypto");
    orgId = (await db.organization.create({ data: { name: "Campanhas", slug: `campaign-${Date.now()}` } })).id;
    connectionId = (await db.connection.create({ data: { organizationId: orgId, label: "Teste", provider: "WHATSAPP_EVOLUTION", status: "CONNECTED", config: encryptJson({ baseUrl: "https://invalid.test", apiKey: "not-real", instanceName: "test" }) } })).id;
  });
  beforeEach(() => { send.mockReset(); send.mockImplementation(async () => ({ key: { id: `fake-${Date.now()}-${Math.random()}` } })); });
  afterAll(async () => { if (orgId) await db.organization.delete({ where: { id: orgId } }); await db?.$disconnect(); });
  async function fixture(dailyLimit = 0) {
    const campaign = await db.campaign.create({ data: { organizationId: orgId, connectionId, name: "Teste", body: "Olá {{nome}}", status: "RUNNING", batchSize: 25, dailyLimit, sendWindowStart: 0, sendWindowEnd: 24, duplicateWindowHours: 0 } });
    for (let index = 0; index < 3; index++) {
      const contact = await db.contact.create({ data: { organizationId: orgId, name: `Cliente ${index}`, phone: `551199999000${index}` } });
      await db.campaignRecipient.create({ data: { campaignId: campaign.id, contactId: contact.id } });
    }
    return campaign;
  }
  it("um lote não ultrapassa o saldo do limite diário", async () => {
    const campaign = await fixture(1);
    await processCampaign(campaign.id);
    expect(send).toHaveBeenCalledTimes(1);
    expect(await db.campaignRecipient.count({ where: { campaignId: campaign.id, status: "PENDING" } })).toBe(2);
  });
  it("dois workers não processam o mesmo lote simultaneamente", async () => {
    const campaign = await fixture();
    await Promise.all([processCampaign(campaign.id), processCampaign(campaign.id)]);
    expect(send).toHaveBeenCalledTimes(3);
    expect(await db.campaignRecipient.count({ where: { campaignId: campaign.id, status: "SENT" } })).toBe(3);
  });
  it("pausa interrompe o lote antes do próximo destinatário", async () => {
    const campaign = await fixture();
    send.mockImplementationOnce(async () => {
      await db.campaign.update({ where: { id: campaign.id }, data: { status: "PAUSED", nextRunAt: null } });
      return { key: { id: "paused-receipt" } };
    });
    await processCampaign(campaign.id);
    expect(send).toHaveBeenCalledTimes(1);
    expect((await db.campaign.findUniqueOrThrow({ where: { id: campaign.id } })).status).toBe("PAUSED");
  });
});
