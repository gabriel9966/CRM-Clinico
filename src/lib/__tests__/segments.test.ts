import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockPrisma } from "../../../test/mock-prisma";

const mockPrisma = createMockPrisma();

vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));

const { evaluateSegment, parseSegmentFilters, segmentWhere } = await import("../segments");

const ORG = "org-a";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("parseSegmentFilters", () => {
  it("retorna lista vazia de condições em JSON inválido", () => {
    expect(parseSegmentFilters("not json")).toEqual({ conditions: [] });
  });

  it("faz parse de condições válidas", () => {
    const raw = JSON.stringify({ conditions: [{ field: "tag", value: "vip" }] });
    expect(parseSegmentFilters(raw)).toEqual({ conditions: [{ field: "tag", value: "vip" }] });
  });
});

// O filtro agora roda no banco: aqui conferimos a CLÁUSULA gerada. O resultado
// real (tag exata, JSON de campo extra, datas) é validado nos testes de integração.
describe("segmentWhere", () => {
  it("combina critérios com AND", () => {
    const w = segmentWhere(JSON.stringify({ conditions: [{ field: "tag", value: "vip" }, { field: "owner", value: "u1" }] }));
    expect(w.AND).toEqual([{ tags: { contains: '"vip"' } }, { ownerId: "u1" }]);
  });

  it("tag usa o texto entre aspas (não casa com tag de nome parecido)", () => {
    const [clause] = segmentWhere(JSON.stringify({ conditions: [{ field: "tag", value: "VIP" }] })).AND;
    expect(clause).toEqual({ tags: { contains: '"VIP"' } });
  });

  it("responsável nulo filtra contatos sem responsável", () => {
    const [clause] = segmentWhere(JSON.stringify({ conditions: [{ field: "owner", value: null }] })).AND;
    expect(clause).toEqual({ ownerId: null });
  });

  it("campo extra tenta texto, número e booleano", () => {
    const [num] = segmentWhere(JSON.stringify({ conditions: [{ field: "customField", key: "idade", value: "30" }] })).AND;
    expect(num).toEqual({
      OR: [
        { customFields: { path: ["idade"], equals: "30" } },
        { customFields: { path: ["idade"], equals: 30 } },
      ],
    });
    const [bool] = segmentWhere(JSON.stringify({ conditions: [{ field: "customField", key: "vip", value: "true" }] })).AND;
    expect((bool as { OR: unknown[] }).OR).toHaveLength(2);
    expect(JSON.stringify(bool)).toContain('"equals":true');
  });

  it("datas viram intervalo em createdAt", () => {
    const w = segmentWhere(
      JSON.stringify({ conditions: [{ field: "createdAfter", value: "2030-01-01" }, { field: "createdBefore", value: "2030-02-01" }] })
    );
    expect(w.AND[0]).toEqual({ createdAt: { gte: new Date("2030-01-01") } });
    expect(w.AND[1]).toEqual({ createdAt: { lte: new Date("2030-02-01") } });
  });

  it("sem condições não restringe nada", () => {
    expect(segmentWhere("{}").AND).toEqual([]);
  });
});

describe("evaluateSegment", () => {
  it("consulta o banco filtrando por organização e devolve só ids", async () => {
    mockPrisma.contact.findMany.mockResolvedValue([{ id: "c1" }]);
    const filters = JSON.stringify({ conditions: [{ field: "tag", value: "vip" }] });

    const result = await evaluateSegment(ORG, "CONTACT", filters);

    expect(result).toEqual([{ id: "c1" }]);
    expect(mockPrisma.contact.findMany).toHaveBeenCalledWith({
      where: { organizationId: ORG, AND: [{ tags: { contains: '"vip"' } }] },
      select: { id: true },
    });
  });

  it("oportunidades usam a tabela de oportunidades", async () => {
    mockPrisma.opportunity.findMany.mockResolvedValue([{ id: "o1" }]);
    await evaluateSegment(ORG, "OPPORTUNITY", "{}");
    expect(mockPrisma.opportunity.findMany).toHaveBeenCalledWith({ where: { organizationId: ORG, AND: [] }, select: { id: true } });
    expect(mockPrisma.contact.findMany).not.toHaveBeenCalled();
  });
});
