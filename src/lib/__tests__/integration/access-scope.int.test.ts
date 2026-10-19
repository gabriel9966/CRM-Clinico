// Níveis de acesso (carteira "só os meus / equipe / todos") contra Postgres real.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { matchProfile, ACCESS_PROFILES, scopeWhere, ownerInScope } from "@/lib/access-scope";

const url = process.env.TEST_DATABASE_URL;
const session: { user: Record<string, unknown> | null } = { user: null };

vi.mock("@/lib/auth", () => ({
  requireOrgUser: async () => session.user,
  requireAdminUser: async () => session.user,
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/automation/engine", () => ({ triggerAutomations: vi.fn() }));

describe("perfis e escopo (puro)", () => {
  it("cada perfil pronto é reconhecido de volta; mudar uma permissão vira personalizado", () => {
    for (const p of ACCESS_PROFILES) expect(matchProfile({ role: p.role, dataScope: p.dataScope, seeUnassigned: p.seeUnassigned, permissions: [...p.permissions] })).toBe(p.id);
    const seller = ACCESS_PROFILES.find((p) => p.id === "seller")!;
    expect(matchProfile({ role: "MEMBER", dataScope: "own", seeUnassigned: false, permissions: [...seller.permissions, "campaigns.read"] })).toBe("custom");
  });

  it("scopeWhere/ownerInScope: null = todos; fila só quando liberada", () => {
    expect(scopeWhere(null)).toEqual({});
    expect(scopeWhere({ ids: ["a"], includeUnassigned: true })).toEqual({ OR: [{ ownerId: { in: ["a"] } }, { ownerId: null }] });
    expect(ownerInScope({ ids: ["a"], includeUnassigned: false }, null)).toBe(false);
    expect(ownerInScope({ ids: ["a"], includeUnassigned: true }, null)).toBe(true);
    expect(ownerInScope({ ids: ["a"], includeUnassigned: true }, "b")).toBe(false);
  });
});

describe.skipIf(!url)("carteira de dados (Postgres real)", () => {
  let prisma: typeof import("@/lib/prisma").prismaRaw;
  let listings: typeof import("@/app/listings/actions");
  let contacts: typeof import("@/app/contacts/actions");
  let pipelineActions: typeof import("@/app/pipeline/actions");
  let team: typeof import("@/app/team/actions");
  let access: typeof import("@/lib/access");
  let orgId: string;
  const users: Record<string, Record<string, unknown>> = {};
  const contactIds: Record<string, string> = {};
  let pipelineId: string;
  let stages: string[] = [];
  const oppIds: Record<string, string> = {};

  const ALL = ["contacts.read", "contacts.write", "pipeline.read", "pipeline.write", "conversations.read", "conversations.reply"];

  async function mkUser(key: string, data: { role?: "ADMIN" | "MEMBER"; team?: string; dataScope?: string; seeUnassigned?: boolean }) {
    const u = await prisma.user.create({
      data: { organizationId: orgId, name: key, email: `${key}-${orgId}@t.com`, passwordHash: "x", role: data.role ?? "MEMBER", team: data.team ?? "Geral", dataScope: data.dataScope ?? "own", seeUnassigned: data.seeUnassigned ?? true, permissions: JSON.stringify(ALL) },
    });
    users[key] = u as unknown as Record<string, unknown>;
    return u;
  }
  const as = (key: string) => { session.user = users[key]; };
  const visibleNames = async () => (await listings.fetchContactsPage({})).items.map((c) => c.name).sort();

  beforeAll(async () => {
    process.env.DATABASE_URL = url!;
    ({ prismaRaw: prisma } = await import("@/lib/prisma"));
    listings = await import("@/app/listings/actions");
    contacts = await import("@/app/contacts/actions");
    pipelineActions = await import("@/app/pipeline/actions");
    team = await import("@/app/team/actions");
    access = await import("@/lib/access");
    orgId = (await prisma.organization.create({ data: { name: "Escopo", slug: `esc-${Date.now().toString(36)}` } })).id;

    await mkUser("ana", { team: "Vendas" });                       // só os dela + fila
    await mkUser("bia", { team: "Vendas", seeUnassigned: false }); // só os dela, sem fila
    await mkUser("caio", { team: "Suporte", dataScope: "team" });  // equipe Suporte
    await mkUser("duda", { team: "Suporte" });
    await mkUser("gestor", { dataScope: "all" });
    await mkUser("admin", { role: "ADMIN", dataScope: "own" });    // ADMIN ignora o escopo

    for (const [name, owner] of [["C-ana", "ana"], ["C-bia", "bia"], ["C-caio", "caio"], ["C-duda", "duda"], ["C-fila", null]] as const) {
      contactIds[name] = (await prisma.contact.create({ data: { organizationId: orgId, name, ownerId: owner ? (users[owner].id as string) : null } })).id;
    }
    const pl = await prisma.pipeline.create({ data: { organizationId: orgId, name: "Vendas", stages: { create: [{ label: "Novo", color: "#000", order: 0 }, { label: "Proposta", color: "#111", order: 1 }] } }, include: { stages: true } });
    pipelineId = pl.id;
    stages = pl.stages.sort((a, b) => a.order - b.order).map((s) => s.id);
    for (const key of ["ana", "bia", "caio", "duda", "gestor", "admin"]) {
      await prisma.userPipelineAccess.create({ data: { userId: users[key].id as string, pipelineId, canView: true, canEdit: true } });
    }
    for (const [name, owner] of [["N-ana", "ana"], ["N-bia", "bia"], ["N-duda", "duda"]] as const) {
      oppIds[name] = (await prisma.opportunity.create({ data: { organizationId: orgId, title: name, pipelineId, stageId: stages[0], contactId: contactIds[`C-${owner}`], ownerId: users[owner].id as string } })).id;
    }
  });

  afterAll(async () => {
    await prisma.organization.deleteMany({ where: { id: orgId } });
    await prisma.$disconnect();
  });

  it("contatos: cada um vê a sua carteira", async () => {
    as("ana"); expect(await visibleNames()).toEqual(["C-ana", "C-fila"]);
    as("bia"); expect(await visibleNames()).toEqual(["C-bia"]);
    as("caio"); expect(await visibleNames()).toEqual(["C-caio", "C-duda", "C-fila"]);
    as("gestor"); expect((await visibleNames()).length).toBe(5);
    as("admin"); expect((await visibleNames()).length).toBe(5);
  });

  it("detalhe de contato de outra carteira não abre", async () => {
    as("ana");
    expect(await listings.fetchContactDetail(contactIds["C-bia"])).toBeNull();
    expect(await listings.fetchContactDetail(contactIds["C-ana"])).not.toBeNull();
  });

  it("pipeline: cartões e totais respeitam a carteira", async () => {
    as("ana");
    const board = await listings.fetchPipelineBoard(pipelineId);
    expect(board[stages[0]].cards.map((c) => c.title)).toEqual(["N-ana"]);
    expect(board[stages[0]].count).toBe(1);
    as("caio");
    expect((await listings.fetchStageCards(stages[0])).items.map((c) => c.title)).toEqual(["N-duda"]);
    as("gestor");
    expect((await listings.fetchStageSummaries(pipelineId)).find((s) => s.stageId === stages[0])?.count).toBe(3);
  });

  it("não altera, move nem exclui o que está fora da carteira", async () => {
    as("ana");
    await expect(contacts.updateContact(contactIds["C-bia"], { name: "hack", company: "", email: "", phone: "", tags: [], notes: "", ownerId: users.ana.id as string })).rejects.toThrow(/carteira/);
    await expect(pipelineActions.moveOpportunityStage(oppIds["N-bia"], stages[1])).rejects.toThrow(/carteira/);
    await expect(contacts.deleteContact(contactIds["C-bia"])).rejects.toThrow(/carteira/);
    expect((await prisma.contact.findUniqueOrThrow({ where: { id: contactIds["C-bia"] } })).name).toBe("C-bia");
    // a própria carteira continua livre
    await pipelineActions.moveOpportunityStage(oppIds["N-ana"], stages[1]);
    expect((await prisma.opportunity.findUniqueOrThrow({ where: { id: oppIds["N-ana"] } })).stageId).toBe(stages[1]);
  });

  it("ações em lote ignoram contatos fora da carteira", async () => {
    as("ana");
    await contacts.bulkUpdateContacts([contactIds["C-ana"], contactIds["C-bia"]], { addTags: ["lote"] });
    expect((await prisma.contact.findUniqueOrThrow({ where: { id: contactIds["C-ana"] } })).tags).toContain("lote");
    expect((await prisma.contact.findUniqueOrThrow({ where: { id: contactIds["C-bia"] } })).tags).not.toContain("lote");
  });

  it("conversas: a lista respeita a carteira", async () => {
    // Conversas também exigem acesso à instância (regra já existente).
    const conn = await prisma.connection.create({ data: { organizationId: orgId, provider: "WHATSAPP_EVOLUTION", label: "WA", status: "CONNECTED" } });
    for (const key of ["ana", "bia"]) await prisma.userConnectionAccess.create({ data: { userId: users[key].id as string, connectionId: conn.id, canView: true, canSend: true } });
    for (const [name, owner] of [["C-ana", "ana"], ["C-bia", "bia"], ["C-fila", null]] as const) {
      await prisma.conversation.create({ data: { organizationId: orgId, contactId: contactIds[name], connectionId: conn.id, ownerId: owner ? (users[owner].id as string) : null, lastMessageAt: new Date(), lastMessageText: "oi" } });
    }
    as("ana");
    expect((await listings.fetchConversations({ status: "ALL" })).page.items.map((r) => r.contact.name).sort()).toEqual(["C-ana", "C-fila"]);
    as("bia");
    expect((await listings.fetchConversations({ status: "ALL" })).page.items.map((r) => r.contact.name)).toEqual(["C-bia"]);
  });

  it("cadastro já cria o membro com perfil, carteira, pipelines e canais", async () => {
    as("admin");
    const fd = new FormData();
    fd.set("name", "Nova"); fd.set("email", `nova-${orgId}@t.com`); fd.set("password", "senha-forte-123456"); fd.set("team", "Vendas");
    fd.set("access", JSON.stringify({ role: "MEMBER", permissions: ["contacts.read", "pipeline.read", "inventada"], dataScope: "team", seeUnassigned: false, pipelineAccesses: [{ pipelineId, canEdit: false }], connectionAccesses: [] }));
    const result = await team.createTeamMember({}, fd);
    expect(result.error).toBeUndefined();
    const created = await prisma.user.findFirstOrThrow({ where: { email: `nova-${orgId}@t.com` }, include: { pipelineAccesses: true } });
    expect(created).toMatchObject({ dataScope: "team", seeUnassigned: false, role: "MEMBER" });
    expect(JSON.parse(created.permissions)).toEqual(["contacts.read", "pipeline.read"]); // "inventada" descartada
    expect(created.pipelineAccesses).toEqual([expect.objectContaining({ pipelineId, canView: true, canEdit: false })]);
  });

  it("cadastro recusa pipeline de outra empresa", async () => {
    as("admin");
    const other = await prisma.organization.create({ data: { name: "Outra", slug: `out-${Date.now().toString(36)}` } });
    const foreign = await prisma.pipeline.create({ data: { organizationId: other.id, name: "X" } });
    const fd = new FormData();
    fd.set("name", "Intrusa"); fd.set("email", `intrusa-${orgId}@t.com`); fd.set("password", "senha-forte-123456");
    fd.set("access", JSON.stringify({ role: "MEMBER", permissions: [], dataScope: "own", seeUnassigned: true, pipelineAccesses: [{ pipelineId: foreign.id, canEdit: true }], connectionAccesses: [] }));
    expect((await team.createTeamMember({}, fd)).error).toMatch(/inválida/);
    expect(await prisma.user.count({ where: { email: `intrusa-${orgId}@t.com` } })).toBe(0);
    await prisma.organization.delete({ where: { id: other.id } });
  });

  it("getOwnerScope: equipe inclui os colegas; ADMIN vê tudo", async () => {
    const caio = await access.getOwnerScope(users.caio as never);
    expect(caio?.ids.sort()).toEqual([users.caio.id, users.duda.id].sort());
    expect(await access.getOwnerScope(users.admin as never)).toBeNull();
  });
});
