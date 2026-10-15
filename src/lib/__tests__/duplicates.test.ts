import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockPrisma } from "../../../test/mock-prisma";

const mockPrisma = createMockPrisma();

vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));

const { findDuplicateContacts } = await import("../data");

const ORG = "org-a";

function contact(overrides: Partial<{ id: string; name: string; email: string | null; phone: string | null }>) {
  return {
    id: "c1",
    name: "Contato",
    company: null,
    email: null,
    phone: null,
    tags: "[]",
    notes: null,
    ownerId: null,
    customFields: {},
    createdAt: new Date(),
    ...overrides,
  };
}

// A detecção agora é uma agregação SQL (GROUP BY/HAVING): o primeiro $queryRaw
// devolve os grupos por e-mail, o segundo os por telefone. A correção do SQL em
// si (case-insensitive, só dígitos, lixeira) é coberta nos testes de integração.
function sqlGroups(email: { key: string; ids: string[] }[], phone: { key: string; ids: string[] }[]) {
  mockPrisma.$queryRaw.mockResolvedValueOnce(email).mockResolvedValueOnce(phone);
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe("findDuplicateContacts", () => {
  it("monta o grupo de e-mail com os contatos achados", async () => {
    sqlGroups([{ key: "ana@example.com", ids: ["c1", "c2"] }], []);
    mockPrisma.contact.findMany.mockResolvedValue([
      contact({ id: "c1", email: "Ana@Example.com" }),
      contact({ id: "c2", name: "Ana P.", email: "ana@example.com" }),
    ]);

    const groups = await findDuplicateContacts(ORG);

    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ key: "email:ana@example.com", matchedOn: "email" });
    expect(groups[0].contacts.map((c) => c.id)).toEqual(["c1", "c2"]); // ordem do SQL preservada
  });

  it("monta o grupo de telefone", async () => {
    sqlGroups([], [{ key: "11900000000", ids: ["c1", "c2"] }]);
    mockPrisma.contact.findMany.mockResolvedValue([
      contact({ id: "c1", phone: "(11) 90000-0000" }),
      contact({ id: "c2", phone: "11900000000" }),
    ]);

    const groups = await findDuplicateContacts(ORG);

    expect(groups).toHaveLength(1);
    expect(groups[0].matchedOn).toBe("phone");
  });

  it("sem duplicata não consulta contatos", async () => {
    sqlGroups([], []);
    expect(await findDuplicateContacts(ORG)).toEqual([]);
    expect(mockPrisma.contact.findMany).not.toHaveBeenCalled();
  });

  it("carrega só os contatos dos grupos, filtrando por organização", async () => {
    sqlGroups([{ key: "a@x.com", ids: ["c1", "c2"] }], []);
    mockPrisma.contact.findMany.mockResolvedValue([contact({ id: "c1" }), contact({ id: "c2" })]);
    await findDuplicateContacts(ORG);
    expect(mockPrisma.contact.findMany).toHaveBeenCalledWith({
      where: { organizationId: ORG, id: { in: ["c1", "c2"] } },
    });
  });

  it("descarta o grupo que ficou com menos de 2 contatos (ex.: um foi apagado entre as consultas)", async () => {
    sqlGroups([{ key: "a@x.com", ids: ["c1", "c2"] }], []);
    mockPrisma.contact.findMany.mockResolvedValue([contact({ id: "c1" })]);
    expect(await findDuplicateContacts(ORG)).toEqual([]);
  });
});
