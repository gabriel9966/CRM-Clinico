import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockPrisma } from "../../../test/mock-prisma";

const mockPrisma = createMockPrisma();
vi.mock("../prisma", () => ({ prisma: mockPrisma }));
vi.mock("../crm-catalog", () => ({ syncTags: vi.fn() }));

// mcp-tools também importa os providers de WhatsApp/Instagram pra enviar
// mensagens de verdade — mockados aqui pra isolar o teste da lógica de negócio.
vi.mock("../providers/evolution", () => ({ sendText: vi.fn() }));
vi.mock("../providers/instagram", () => ({ sendText: vi.fn() }));

const {
  mcpListContacts,
  mcpGetContact,
  mcpCreateContact,
  mcpUpdateContact,
  mcpDeleteContact,
  mcpListOpportunities,
  mcpCreateOpportunity,
  mcpUpdateOpportunity,
  mcpDeleteOpportunity,
  mcpMoveOpportunityStage,
  mcpCreateActivity,
  mcpCreateAppointment,
} = await import("../mcp-tools");

const ORG_A = "org-a";
const ORG_B = "org-b";

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.$transaction.mockImplementation(async (fn) => fn(mockPrisma));
});

describe("mcp-tools: isolamento multi-tenant", () => {
  it("mcpListContacts sempre filtra por organizationId", async () => {
    mockPrisma.contact.findMany.mockResolvedValue([]);
    await mcpListContacts(ORG_A, "maria");
    expect(mockPrisma.contact.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ organizationId: ORG_A }) })
    );
  });

  it("mcpGetContact não retorna contato de outra organização", async () => {
    // simula o Prisma aplicando o filtro de verdade: contato pertence à ORG_B,
    // então uma busca com organizationId ORG_A não o encontra.
    mockPrisma.contact.findFirst.mockImplementation(({ where }: any) => {
      if (where.id === "contact-1" && where.organizationId === ORG_B) {
        return { id: "contact-1", organizationId: ORG_B, opportunities: [], messages: [], tags: "[]" };
      }
      return null;
    });

    const asOwner = await mcpGetContact(ORG_B, "contact-1");
    expect(asOwner).not.toBeNull();

    const asIntruder = await mcpGetContact(ORG_A, "contact-1");
    expect(asIntruder).toBeNull();
  });

  it("mcpUpdateContact recusa atualizar contato de outra organização", async () => {
    mockPrisma.contact.findFirst.mockResolvedValue(null); // não encontrado nesta org
    const result = await mcpUpdateContact(ORG_A, "contact-of-org-b", { name: "Hackeado" });
    expect(result).toHaveProperty("error");
    expect(mockPrisma.contact.update).not.toHaveBeenCalled();
  });

  it("mcpDeleteContact recusa apagar contato de outra organização", async () => {
    mockPrisma.contact.findFirst.mockResolvedValue(null);
    const result = await mcpDeleteContact(ORG_A, "contact-of-org-b");
    expect(result.ok).toBe(false);
    expect(mockPrisma.contact.delete).not.toHaveBeenCalled();
  });

  it("mcpCreateOpportunity recusa vincular a um contato de outra organização", async () => {
    mockPrisma.contact.findFirst.mockResolvedValue(null); // contato não pertence à ORG_A
    const result = await mcpCreateOpportunity(ORG_A, {
      title: "Venda",
      contactId: "contact-of-org-b",
      pipelineId: "p1",
      stageId: "s1",
    });
    expect(result).toHaveProperty("error");
    expect(mockPrisma.opportunity.create).not.toHaveBeenCalled();
  });

  it("mcpUpdateOpportunity recusa atualizar oportunidade de outra organização", async () => {
    mockPrisma.opportunity.findFirst.mockResolvedValue(null);
    const result = await mcpUpdateOpportunity(ORG_A, "opp-of-org-b", { title: "Roubado" });
    expect(result).toHaveProperty("error");
    expect(mockPrisma.opportunity.update).not.toHaveBeenCalled();
  });

  it("mcpDeleteOpportunity recusa apagar oportunidade de outra organização", async () => {
    mockPrisma.opportunity.findFirst.mockResolvedValue(null);
    const result = await mcpDeleteOpportunity(ORG_A, "opp-of-org-b");
    expect(result.ok).toBe(false);
    expect(mockPrisma.opportunity.delete).not.toHaveBeenCalled();
  });

  it("mcpMoveOpportunityStage recusa mover oportunidade de outra organização", async () => {
    mockPrisma.opportunity.findFirst.mockResolvedValue(null);
    const result = await mcpMoveOpportunityStage(ORG_A, "opp-of-org-b", "stage-x");
    expect(result.ok).toBe(false);
    expect(mockPrisma.opportunity.update).not.toHaveBeenCalled();
  });

  it("mcpMoveOpportunityStage recusa etapa de outro pipeline/organização", async () => {
    mockPrisma.opportunity.findFirst.mockResolvedValue({ id: "opp-1", organizationId: ORG_A, pipelineId: "p1" });
    mockPrisma.stage.findFirst.mockResolvedValue(null);
    const result = await mcpMoveOpportunityStage(ORG_A, "opp-1", "stage-de-outra-org");
    expect(result.ok).toBe(false);
    expect(mockPrisma.opportunity.update).not.toHaveBeenCalled();
    expect(mockPrisma.stage.findFirst).toHaveBeenCalledWith({
      where: { id: "stage-de-outra-org", pipelineId: "p1", pipeline: { organizationId: ORG_A } },
      select: { id: true },
    });
  });

  it("mcpCreateOpportunity recusa etapa e responsável de outra organização", async () => {
    mockPrisma.contact.findFirst.mockResolvedValue({ id: "c1" });
    mockPrisma.stage.findFirst.mockResolvedValue(null);
    expect(await mcpCreateOpportunity(ORG_A, { title: "x", contactId: "c1", pipelineId: "p", stageId: "s" })).toHaveProperty("error");

    mockPrisma.stage.findFirst.mockResolvedValue({ id: "s" });
    mockPrisma.user.findFirst.mockResolvedValue(null); // responsável não é desta org
    const r = await mcpCreateOpportunity(ORG_A, { title: "x", contactId: "c1", pipelineId: "p", stageId: "s", ownerId: "u-outra-org" });
    expect(r).toHaveProperty("error");
    expect(mockPrisma.opportunity.create).not.toHaveBeenCalled();
  });

  it("mcpCreateContact e mcpUpdateContact recusam responsável de outra organização", async () => {
    mockPrisma.user.findFirst.mockResolvedValue(null);
    await expect(mcpCreateContact(ORG_A, { name: "Ana", ownerId: "u-outra-org" })).rejects.toMatchObject({
      code: "responsavel_invalido",
      status: 404,
    });
    expect(mockPrisma.contact.create).not.toHaveBeenCalled();

    mockPrisma.contact.findFirst.mockResolvedValue({ id: "c1" });
    await expect(mcpUpdateContact(ORG_A, "c1", { ownerId: "u-outra-org" })).rejects.toMatchObject({ code: "responsavel_invalido" });
    expect(mockPrisma.contact.update).not.toHaveBeenCalled();
  });

  it("mcpCreateActivity/mcpCreateAppointment recusam contato e oportunidade de outra organização", async () => {
    mockPrisma.contact.findFirst.mockResolvedValue(null);
    await expect(
      mcpCreateActivity(ORG_A, { title: "Ligar", dueAt: "2030-01-01T10:00:00Z", contactId: "c-outra-org" })
    ).rejects.toMatchObject({ code: "contato_invalido" });
    await expect(
      mcpCreateAppointment(ORG_A, { title: "Consulta", startAt: "2030-01-01T10:00:00Z", endAt: "2030-01-01T11:00:00Z", contactId: "c-outra-org" })
    ).rejects.toMatchObject({ code: "contato_invalido" });

    mockPrisma.opportunity.findFirst.mockResolvedValue(null);
    await expect(
      mcpCreateActivity(ORG_A, { title: "Ligar", dueAt: "2030-01-01T10:00:00Z", opportunityId: "o-outra-org" })
    ).rejects.toMatchObject({ code: "negocio_invalido" });
    expect(mockPrisma.activity.create).not.toHaveBeenCalled();
    expect(mockPrisma.appointment.create).not.toHaveBeenCalled();
  });

  it("mcpListOpportunities filtra por organizationId mesmo com outros filtros", async () => {
    mockPrisma.opportunity.findMany.mockResolvedValue([]);
    await mcpListOpportunities(ORG_A, { pipelineId: "p1" });
    expect(mockPrisma.opportunity.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ organizationId: ORG_A, pipelineId: "p1" }) })
    );
  });
});

describe("mcp-tools: comportamento básico", () => {
  it("mcpCreateContact serializa tags como JSON", async () => {
    mockPrisma.contact.create.mockResolvedValue({ id: "new-contact" });
    const result = await mcpCreateContact(ORG_A, { name: "Marina", tags: ["VIP", "E-commerce"] });
    expect(result).toEqual({ id: "new-contact" });
    expect(mockPrisma.contact.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ tags: JSON.stringify(["VIP", "E-commerce"]) }) })
    );
  });

  it("mcpGetContact faz parse seguro de tags malformadas", async () => {
    mockPrisma.contact.findFirst.mockResolvedValue({
      id: "c1",
      organizationId: ORG_A,
      tags: "not-json",
      opportunities: [],
      messages: [],
    });
    const result = await mcpGetContact(ORG_A, "c1");
    expect(result?.tags).toEqual([]);
  });

  it("mcpMoveOpportunityStage move quando a oportunidade pertence à organização", async () => {
    mockPrisma.opportunity.findFirst.mockResolvedValue({ id: "opp-1", organizationId: ORG_A, pipelineId: "p1" });
    mockPrisma.stage.findFirst.mockResolvedValue({ id: "stage-ganho" });
    mockPrisma.opportunity.update.mockResolvedValue({ id: "opp-1" });
    const result = await mcpMoveOpportunityStage(ORG_A, "opp-1", "stage-ganho");
    expect(result.ok).toBe(true);
    expect(mockPrisma.opportunity.update).toHaveBeenCalledWith({
      where: { id: "opp-1" },
      data: { stageId: "stage-ganho" },
    });
  });
});
