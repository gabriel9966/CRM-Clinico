// Quadro de tarefas (estilo Trello) contra Postgres real. Só roda com TEST_DATABASE_URL.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

const url = process.env.TEST_DATABASE_URL;
const session = { organizationId: "" };

vi.mock("@/lib/auth", () => ({
  requireOrgUser: async () => ({ organizationId: session.organizationId, userId: "u", role: "ADMIN" }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

describe.skipIf(!url)("quadro de tarefas (Postgres real)", () => {
  let prisma: typeof import("@/lib/prisma").prismaRaw;
  let actions: typeof import("@/app/activities/actions");
  let board: typeof import("@/lib/task-board");
  let orgId: string;
  let otherOrgId: string;

  const titles = async (listId: string) => (await board.getListCards(orgId, listId)).cards.map((c) => c.title);
  const card = (title: string, extra: Record<string, unknown> = {}) =>
    prisma.activity.create({ data: { organizationId: orgId, title, dueAt: new Date("2030-01-01"), ...extra } });

  beforeAll(async () => {
    process.env.DATABASE_URL = url!;
    ({ prismaRaw: prisma } = await import("@/lib/prisma"));
    actions = await import("@/app/activities/actions");
    board = await import("@/lib/task-board");
    const tag = Date.now().toString(36);
    orgId = (await prisma.organization.create({ data: { name: "Tarefas A", slug: `ta-${tag}` } })).id;
    otherOrgId = (await prisma.organization.create({ data: { name: "Tarefas B", slug: `tb-${tag}` } })).id;
    session.organizationId = orgId;
  });

  afterAll(async () => {
    await prisma.organization.deleteMany({ where: { id: { in: [orgId, otherOrgId] } } });
    await prisma.$disconnect();
  });

  it("cria as colunas padrão e mostra tarefas antigas (sem coluna) no lugar certo", async () => {
    await card("antiga pendente");
    await card("antiga feita", { done: true });
    const lists = await board.getTaskBoard(orgId);
    expect(lists.map((l) => l.name)).toEqual(["A fazer", "Em andamento", "Concluído"]);
    expect(lists[0].cards.map((c) => c.title)).toEqual(["antiga pendente"]);
    expect(lists[1].cards).toEqual([]);
    expect(lists[2].cards.map((c) => c.title)).toEqual(["antiga feita"]);
  });

  it("criar cartão rápido cai no fim da coluna; arrastar reordena e muda o status de concluída", async () => {
    const [todo, doing, done] = await board.getTaskBoard(orgId);
    await actions.createTaskCard(todo.id, "B");
    await actions.createTaskCard(todo.id, "C");
    expect(await titles(todo.id)).toEqual(["antiga pendente", "B", "C"]);

    const c = await prisma.activity.findFirstOrThrow({ where: { organizationId: orgId, title: "C" } });
    const b = await prisma.activity.findFirstOrThrow({ where: { organizationId: orgId, title: "B" } });
    await actions.moveActivity(c.id, todo.id, b.id); // C antes de B
    expect(await titles(todo.id)).toEqual(["antiga pendente", "C", "B"]);

    await actions.moveActivity(c.id, done.id, null);
    const moved = await prisma.activity.findUniqueOrThrow({ where: { id: c.id } });
    expect(moved).toMatchObject({ listId: done.id, done: true });
    await actions.moveActivity(c.id, doing.id, null);
    expect(await prisma.activity.findUniqueOrThrow({ where: { id: c.id } })).toMatchObject({ listId: doing.id, done: false });
    expect(await titles(doing.id)).toEqual(["C"]);
  });

  it("o check leva o cartão para a coluna de concluídas e de volta", async () => {
    const [todo, , done] = await board.getTaskBoard(orgId);
    const b = await prisma.activity.findFirstOrThrow({ where: { organizationId: orgId, title: "B" } });
    await actions.toggleActivityDone(b.id, true);
    expect(await titles(done.id)).toContain("B");
    await actions.toggleActivityDone(b.id, false);
    expect(await titles(todo.id)).toContain("B");
  });

  it("não move cartão nem usa coluna de outra empresa", async () => {
    const otherList = await prisma.taskList.create({ data: { organizationId: otherOrgId, name: "X", order: 0 } });
    const mine = await prisma.activity.findFirstOrThrow({ where: { organizationId: orgId, title: "B" } });
    await expect(actions.moveActivity(mine.id, otherList.id, null)).rejects.toThrow();
    await expect(actions.createTaskCard(otherList.id, "invasor")).rejects.toThrow();
    const theirs = await prisma.activity.create({ data: { organizationId: otherOrgId, title: "alheio", dueAt: new Date() } });
    const [todo] = await board.getTaskBoard(orgId);
    await expect(actions.moveActivity(theirs.id, todo.id, null)).rejects.toThrow();
  });

  it("excluir coluna manda os cartões para outra do mesmo tipo e mantém ao menos uma de cada", async () => {
    const [todo, doing, done] = await board.getTaskBoard(orgId);
    await actions.deleteTaskList(doing.id);
    const after = await board.getTaskBoard(orgId);
    expect(after.map((l) => l.name)).toEqual(["A fazer", "Concluído"]);
    expect(after[0].cards.map((c) => c.title)).toEqual(expect.arrayContaining(["C", "antiga pendente"]));
    await expect(actions.deleteTaskList(todo.id)).rejects.toThrow(/pendentes/);
    await expect(actions.deleteTaskList(done.id)).rejects.toThrow(/conclu/);
  });

  it("nova coluna entra antes da concluída; reordenar troca a posição", async () => {
    await actions.createTaskList("Revisão");
    let lists = await board.getTaskBoard(orgId);
    expect(lists.map((l) => l.name)).toEqual(["A fazer", "Revisão", "Concluído"]);
    await actions.moveTaskList(lists[1].id, -1);
    lists = await board.getTaskBoard(orgId);
    expect(lists.map((l) => l.name)).toEqual(["Revisão", "A fazer", "Concluído"]);
  });

  it("busca e responsável filtram no servidor", async () => {
    const lists = await board.getTaskBoard(orgId, { search: "antiga" });
    expect(lists.flatMap((l) => l.cards.map((c) => c.title)).sort()).toEqual(["antiga feita", "antiga pendente"]);
  });
});
