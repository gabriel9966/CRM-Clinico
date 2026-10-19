import { describe, it, expect, vi } from "vitest";
import { createMockPrisma } from "../../../test/mock-prisma";
const db = createMockPrisma();
vi.mock("../prisma", () => ({ prisma: db }));
const { hasModulePermission, allowedPipelineIds, allowedConnectionIds } = await import("../access");

describe("acesso restritivo", () => {
  it("contas legadas não recebem permissão implicitamente", () => {
    expect(hasModulePermission({ role: "MEMBER", accessConfigured: false, permissions: "[]" }, "contacts.read")).toBe(false);
  });
  it("somente admin pode herdar todo o escopo", async () => {
    const member = { id: "u", role: "MEMBER", accessConfigured: false, organizationId: "o" };
    db.userPipelineAccess.findMany.mockResolvedValue([]);
    db.userConnectionAccess.findMany.mockResolvedValue([]);
    expect(await allowedPipelineIds(member)).toEqual([]);
    expect(await allowedConnectionIds(member)).toEqual([]);
    expect(await allowedPipelineIds({ ...member, role: "ADMIN" })).toBeNull();
  });
});
