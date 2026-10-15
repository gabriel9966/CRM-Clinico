import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockPrisma } from "../../../test/mock-prisma";

const mockPrisma = createMockPrisma();

const { recordStageChange } = await import("../pipeline-history");

const ORG = "org-a";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("recordStageChange", () => {
  it("abre o primeiro registro quando não há histórico aberto", async () => {
    mockPrisma.opportunityStageHistory.findFirst.mockResolvedValue(null);
    mockPrisma.opportunityStageHistory.create.mockResolvedValue({});

    await recordStageChange(mockPrisma as never, { organizationId: ORG, opportunityId: "opp-1", newStageId: "stage-a" });

    expect(mockPrisma.opportunityStageHistory.update).not.toHaveBeenCalled();
    expect(mockPrisma.opportunityStageHistory.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ organizationId: ORG, opportunityId: "opp-1", stageId: "stage-a" }),
    });
  });

  it("fecha o registro aberto e abre um novo quando a etapa muda", async () => {
    mockPrisma.opportunityStageHistory.findFirst.mockResolvedValue({ id: "hist-1", stageId: "stage-a", exitedAt: null });
    mockPrisma.opportunityStageHistory.update.mockResolvedValue({});
    mockPrisma.opportunityStageHistory.create.mockResolvedValue({});

    await recordStageChange(mockPrisma as never, { organizationId: ORG, opportunityId: "opp-1", newStageId: "stage-b" });

    expect(mockPrisma.opportunityStageHistory.update).toHaveBeenCalledWith({
      where: { id: "hist-1" },
      data: expect.objectContaining({ exitedAt: expect.any(Date) }),
    });
    expect(mockPrisma.opportunityStageHistory.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ opportunityId: "opp-1", stageId: "stage-b" }),
    });
  });

  it("não faz nada quando a oportunidade já está na etapa de destino", async () => {
    mockPrisma.opportunityStageHistory.findFirst.mockResolvedValue({ id: "hist-1", stageId: "stage-a", exitedAt: null });

    await recordStageChange(mockPrisma as never, { organizationId: ORG, opportunityId: "opp-1", newStageId: "stage-a" });

    expect(mockPrisma.opportunityStageHistory.update).not.toHaveBeenCalled();
    expect(mockPrisma.opportunityStageHistory.create).not.toHaveBeenCalled();
  });
});
