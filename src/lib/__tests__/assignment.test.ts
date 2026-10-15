import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockPrisma } from "../../../test/mock-prisma";

const mockPrisma = createMockPrisma();

vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));

const { assignNextOwner } = await import("../assignment");

const ORG = "org-a";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("assignNextOwner", () => {
  it("retorna null quando não há membros ativos", async () => {
    mockPrisma.organization.findUnique.mockResolvedValue({ lastAssignedUserId: null });
    mockPrisma.user.findMany.mockResolvedValue([]);

    const result = await assignNextOwner(ORG);
    expect(result).toBeNull();
    expect(mockPrisma.organization.update).not.toHaveBeenCalled();
  });

  it("começa pelo primeiro membro quando ainda não há ponteiro", async () => {
    mockPrisma.organization.findUnique.mockResolvedValue({ lastAssignedUserId: null });
    mockPrisma.user.findMany.mockResolvedValue([{ id: "u1" }, { id: "u2" }]);
    mockPrisma.organization.update.mockResolvedValue({});

    const result = await assignNextOwner(ORG);
    expect(result).toBe("u1");
    expect(mockPrisma.organization.update).toHaveBeenCalledWith({ where: { id: ORG }, data: { lastAssignedUserId: "u1" } });
  });

  it("avança pro próximo membro após o último atribuído", async () => {
    mockPrisma.organization.findUnique.mockResolvedValue({ lastAssignedUserId: "u1" });
    mockPrisma.user.findMany.mockResolvedValue([{ id: "u1" }, { id: "u2" }]);
    mockPrisma.organization.update.mockResolvedValue({});

    const result = await assignNextOwner(ORG);
    expect(result).toBe("u2");
  });

  it("dá a volta pro início quando o último atribuído é o último da lista", async () => {
    mockPrisma.organization.findUnique.mockResolvedValue({ lastAssignedUserId: "u2" });
    mockPrisma.user.findMany.mockResolvedValue([{ id: "u1" }, { id: "u2" }]);
    mockPrisma.organization.update.mockResolvedValue({});

    const result = await assignNextOwner(ORG);
    expect(result).toBe("u1");
  });

  it("volta ao primeiro se o último atribuído não está mais entre os ativos", async () => {
    mockPrisma.organization.findUnique.mockResolvedValue({ lastAssignedUserId: "u-saiu" });
    mockPrisma.user.findMany.mockResolvedValue([{ id: "u1" }, { id: "u2" }]);
    mockPrisma.organization.update.mockResolvedValue({});

    const result = await assignNextOwner(ORG);
    expect(result).toBe("u1");
  });
});
