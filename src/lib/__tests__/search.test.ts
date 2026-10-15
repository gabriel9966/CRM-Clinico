import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockPrisma } from "../../../test/mock-prisma";

const mockPrisma = createMockPrisma();

vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));

const { globalSearch } = await import("../search");

const ORG = "org-a";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("globalSearch", () => {
  it("retorna vazio sem precisar consultar o banco quando a query é vazia", async () => {
    const result = await globalSearch(ORG, "   ");
    expect(result).toEqual({ contacts: [], opportunities: [] });
    expect(mockPrisma.contact.findMany).not.toHaveBeenCalled();
  });

  it("mapeia contatos e oportunidades encontrados", async () => {
    mockPrisma.contact.findMany.mockResolvedValue([
      { id: "c1", name: "Ana", company: null, email: "ana@ex.com", phone: null, tags: "[]", notes: null, ownerId: null, customFields: {}, createdAt: new Date() },
    ]);
    mockPrisma.opportunity.findMany.mockResolvedValue([
      {
        id: "o1", title: "Negócio Ana", value: 100, tags: "[]", contactId: "c1", pipelineId: "p1", stageId: "s1",
        ownerId: null, expectedClose: null, lossReason: null, customFields: {}, createdAt: new Date(),
        contact: { name: "Ana" },
      },
    ]);

    const result = await globalSearch(ORG, "ana");

    expect(result.contacts).toHaveLength(1);
    expect(result.contacts[0].id).toBe("c1");
    expect(result.opportunities).toHaveLength(1);
    expect(result.opportunities[0].contactName).toBe("Ana");
  });
});
