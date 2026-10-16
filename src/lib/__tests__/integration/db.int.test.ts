// Testes de integração contra um Postgres REAL. Só rodam quando
// TEST_DATABASE_URL está definido (um banco descartável com o schema aplicado
// por `prisma db push`) — o `npm test` comum continua usando mocks.
//   TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54329/crm npm test
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

vi.mock("@/lib/providers/google-calendar", () => ({
  createCalendarEvent: vi.fn(),
  updateCalendarEvent: vi.fn().mockResolvedValue(undefined),
  deleteCalendarEvent: vi.fn().mockResolvedValue(undefined),
}));

const url = process.env.TEST_DATABASE_URL;

// 2030-01-07 é segunda-feira (09:00 em São Paulo = 12:00Z).
const at = (hhmm: string, day = "2030-01-07") => `${day}T${hhmm}:00-03:00`;

describe.skipIf(!url)("integração com Postgres real", () => {
  type Mods = {
    prisma: typeof import("@/lib/prisma").prisma;
    prismaRaw: typeof import("@/lib/prisma").prismaRaw;
    soft: typeof import("@/lib/soft-delete");
    trash: typeof import("@/lib/trash");
    svc: typeof import("@/lib/scheduling/service");
    catalog: typeof import("@/lib/scheduling/catalog");
    audit: typeof import("@/lib/audit");
    inbound: typeof import("@/lib/inbound");
  };
  let m: Mods;
  let orgId: string;
  let otherOrgId: string;
  let proId: string;
  let pro2Id: string;

  beforeAll(async () => {
    process.env.DATABASE_URL = url!;
    const [{ prisma, prismaRaw }, soft, trash, svc, catalog, audit, inbound] = await Promise.all([
      import("@/lib/prisma"),
      import("@/lib/soft-delete"),
      import("@/lib/trash"),
      import("@/lib/scheduling/service"),
      import("@/lib/scheduling/catalog"),
      import("@/lib/audit"),
      import("@/lib/inbound"),
    ]);
    m = { prisma, prismaRaw, soft, trash, svc, catalog, audit, inbound };

    const tag = Date.now().toString(36);
    orgId = (await prismaRaw.organization.create({ data: { name: "Org A", slug: `a-${tag}` } })).id;
    otherOrgId = (await prismaRaw.organization.create({ data: { name: "Org B", slug: `b-${tag}` } })).id;
    proId = (await prismaRaw.professional.create({ data: { organizationId: orgId, name: "Ana", workStartMin: 540, workEndMin: 720 } })).id;
    pro2Id = (await prismaRaw.professional.create({ data: { organizationId: orgId, name: "Bia", workStartMin: 540, workEndMin: 720 } })).id;
  });

  afterAll(async () => {
    if (!m) return;
    await m.prismaRaw.organization.deleteMany({ where: { id: { in: [orgId, otherOrgId] } } });
    await m.prismaRaw.$disconnect();
  });

  // ── Lixeira ──────────────────────────────────────────────────────────────
  describe("lixeira (soft delete)", () => {
    it("contato apagado some das consultas normais mas continua no banco, com dependentes", async () => {
      const { prisma, prismaRaw, soft } = m;
      const c = await prisma.contact.create({ data: { organizationId: orgId, name: "Maria Lixeira", phone: "11999990001" } });
      const pl = await prismaRaw.pipeline.create({
        data: { organizationId: orgId, name: "P", stages: { create: [{ label: "Novo", color: "#000", order: 0 }] } },
        include: { stages: true },
      });
      const opp = await prisma.opportunity.create({
        data: { organizationId: orgId, title: "Botox", contactId: c.id, pipelineId: pl.id, stageId: pl.stages[0].id },
      });
      const ap = await prisma.appointment.create({
        data: { organizationId: orgId, title: "Consulta", contactId: c.id, startAt: new Date(), endAt: new Date(Date.now() + 3600_000) },
      });

      const res = await soft.softDeleteContacts(prisma, orgId, [c.id]);
      expect(res.count).toBe(1);

      expect(await prisma.contact.findFirst({ where: { id: c.id } })).toBeNull();
      expect(await prisma.contact.findUnique({ where: { id: c.id } })).toBeNull();
      expect(await prisma.contact.count({ where: { id: c.id } })).toBe(0);
      expect((await prisma.contact.findMany({ where: { organizationId: orgId, id: c.id } })).length).toBe(0);
      expect(await prisma.opportunity.findFirst({ where: { id: opp.id } })).toBeNull();
      expect(await prisma.appointment.findFirst({ where: { id: ap.id } })).toBeNull();

      const raw = await prismaRaw.contact.findUnique({ where: { id: c.id } });
      expect(raw?.deletedAt).toBeInstanceOf(Date);
    });

    it("update em registro da lixeira falha (não dá para editar o que foi apagado)", async () => {
      const { prisma, prismaRaw } = m;
      const c = await prisma.contact.create({ data: { organizationId: orgId, name: "Editar apagado" } });
      await prismaRaw.contact.update({ where: { id: c.id }, data: { deletedAt: new Date() } });
      await expect(prisma.contact.update({ where: { id: c.id }, data: { name: "x" } })).rejects.toThrow();
      expect(await prisma.contact.updateMany({ where: { id: c.id }, data: { name: "x" } })).toEqual({ count: 0 });
    });

    it("exclusão física por engano é bloqueada", async () => {
      const { prisma } = m;
      const c = await prisma.contact.create({ data: { organizationId: orgId, name: "Não apagar" } });
      await expect(prisma.contact.delete({ where: { id: c.id } })).rejects.toThrow(/softDelete/);
      await expect(prisma.contact.deleteMany({ where: { id: c.id } })).rejects.toThrow(/softDelete/);
      await expect(prisma.opportunity.deleteMany({})).rejects.toThrow(/softDelete/);
      await expect(prisma.appointment.delete({ where: { id: "x" } })).rejects.toThrow(/softDelete/);
      expect(await prisma.contact.findFirst({ where: { id: c.id } })).not.toBeNull();
    });

    it("restaurar contato traz de volta o conjunto apagado junto, não o que já estava na lixeira", async () => {
      const { prisma, prismaRaw, soft, trash } = m;
      const c = await prisma.contact.create({ data: { organizationId: orgId, name: "Restaurar" } });
      const pl = await prismaRaw.pipeline.findFirstOrThrow({ where: { organizationId: orgId }, include: { stages: true } });
      const base = { organizationId: orgId, contactId: c.id, pipelineId: pl.id, stageId: pl.stages[0].id };
      const antiga = await prisma.opportunity.create({ data: { ...base, title: "Apagada antes" } });
      const junto = await prisma.opportunity.create({ data: { ...base, title: "Apagada junto" } });

      await soft.softDeleteOpportunity(prisma, orgId, antiga.id, new Date(Date.now() - 86_400_000));
      await soft.softDeleteContacts(prisma, orgId, [c.id]);

      await trash.restore(orgId, "contact", c.id, { actorName: "Teste" });

      expect(await prisma.contact.findFirst({ where: { id: c.id } })).not.toBeNull();
      expect(await prisma.opportunity.findFirst({ where: { id: junto.id } })).not.toBeNull();
      expect(await prisma.opportunity.findFirst({ where: { id: antiga.id } })).toBeNull();
    });

    it("não restaura negócio enquanto o contato dele estiver na lixeira", async () => {
      const { prisma, prismaRaw, soft, trash } = m;
      const c = await prisma.contact.create({ data: { organizationId: orgId, name: "Dono" } });
      const pl = await prismaRaw.pipeline.findFirstOrThrow({ where: { organizationId: orgId }, include: { stages: true } });
      const opp = await prisma.opportunity.create({
        data: { organizationId: orgId, title: "Orfão", contactId: c.id, pipelineId: pl.id, stageId: pl.stages[0].id },
      });
      await soft.softDeleteContacts(prisma, orgId, [c.id]);
      await expect(trash.restore(orgId, "opportunity", opp.id)).rejects.toMatchObject({ code: "contato_na_lixeira" });
    });

    it("lixeira é isolada por organização", async () => {
      const { prisma, trash } = m;
      const c = await prisma.contact.create({ data: { organizationId: orgId, name: "Só da Org A" } });
      await m.soft.softDeleteContacts(prisma, orgId, [c.id]);
      expect((await trash.listTrash(otherOrgId)).length).toBe(0);
      await expect(trash.restore(otherOrgId, "contact", c.id)).rejects.toMatchObject({ code: "nao_encontrado" });
      await expect(trash.purge(otherOrgId, "contact", c.id)).rejects.toMatchObject({ code: "nao_encontrado" });
      expect((await trash.listTrash(orgId)).some((i) => i.id === c.id)).toBe(true);
    });

    it("excluir definitivamente só vale para o que está na lixeira", async () => {
      const { prisma, prismaRaw, trash } = m;
      const vivo = await prisma.contact.create({ data: { organizationId: orgId, name: "Vivo" } });
      await expect(trash.purge(orgId, "contact", vivo.id)).rejects.toMatchObject({ code: "nao_encontrado" });

      await m.soft.softDeleteContacts(prisma, orgId, [vivo.id]);
      await trash.purge(orgId, "contact", vivo.id);
      expect(await prismaRaw.contact.findUnique({ where: { id: vivo.id } })).toBeNull();
    });

    it("soft delete dentro de transação interativa não trava (caso do mergeContacts)", async () => {
      const { prisma, soft } = m;
      const a = await prisma.contact.create({ data: { organizationId: orgId, name: "Mesclar A" } });
      const b = await prisma.contact.create({ data: { organizationId: orgId, name: "Mesclar B" } });
      await prisma.$transaction(async (tx) => {
        await tx.contact.update({ where: { id: a.id }, data: { notes: "unido" } });
        await soft.softDeleteContacts(tx, orgId, [b.id]);
      });
      expect(await prisma.contact.findFirst({ where: { id: b.id } })).toBeNull();
      expect((await prisma.contact.findFirst({ where: { id: a.id } }))?.notes).toBe("unido");
    });

    it("mensagem de canal cujo contato foi apagado vai para um contato ativo e reaponta o canal", async () => {
      const { prisma, prismaRaw, soft, inbound } = m;
      const conn = await prismaRaw.connection.create({
        data: { organizationId: orgId, provider: "WHATSAPP_EVOLUTION", label: "wpp", status: "CONNECTED" },
      });
      const c = await prisma.contact.create({ data: { organizationId: orgId, name: "Antigo", phone: "+5511988887777" } });
      const ch = await prismaRaw.contactChannel.create({ data: { connectionId: conn.id, externalId: "5511988887777@s.whatsapp.net", contactId: c.id } });
      await soft.softDeleteContacts(prisma, orgId, [c.id]);

      const novoId = await inbound.ensureLiveContact(ch, orgId, { name: "Novo", phone: "+5511988887777" });
      expect(novoId).not.toBe(c.id);
      expect((await prismaRaw.contactChannel.findUniqueOrThrow({ where: { id: ch.id } })).contactId).toBe(novoId);
      // chamada seguinte reaproveita, sem criar outro
      const again = await inbound.ensureLiveContact({ id: ch.id, contactId: novoId }, orgId, { name: "Novo", phone: "+5511988887777" });
      expect(again).toBe(novoId);
    });
  });

  // ── Agenda ───────────────────────────────────────────────────────────────
  describe("agenda (disponibilidade e reserva)", () => {
    it("reserva, recusa horário ocupado e respeita bloqueio", async () => {
      const { svc, catalog } = m;
      const first = await svc.bookAppointment(orgId, { startAt: at("09:00"), durationMin: 60, professionalId: proId, allowReassign: false });
      expect(first).toMatchObject({ professionalId: proId, idempotent: false });

      await expect(
        svc.bookAppointment(orgId, { startAt: at("09:30"), durationMin: 60, professionalId: proId, allowReassign: false })
      ).rejects.toMatchObject({ code: expect.stringMatching(/slot_indisponivel|profissional_ocupado/) });

      // outro profissional livre no mesmo horário → realoca
      const second = await svc.bookAppointment(orgId, { startAt: at("09:30"), durationMin: 60, professionalId: proId });
      expect(second).toMatchObject({ professionalId: pro2Id, professionalReassigned: true });

      await catalog.createBlock(orgId, { professionalId: proId, isRecurring: false, date: "2030-01-07", startMin: 600, endMin: 660 });
      await expect(
        svc.bookAppointment(orgId, { startAt: at("10:00"), durationMin: 30, professionalId: proId, allowReassign: false })
      ).rejects.toBeTruthy();
    });

    it("duas reservas simultâneas no mesmo horário: só uma vence", async () => {
      const { svc, prismaRaw } = m;
      const day = "2030-01-08"; // terça
      const orgSolo = (await prismaRaw.organization.create({ data: { name: "Solo", slug: `solo-${Date.now().toString(36)}` } })).id;
      const solo = await prismaRaw.professional.create({ data: { organizationId: orgSolo, name: "Única", workStartMin: 540, workEndMin: 720 } });
      try {
        const attempts = await Promise.allSettled(
          Array.from({ length: 6 }, (_, i) =>
            svc.bookAppointment(orgSolo, {
              startAt: at("10:00", day),
              durationMin: 60,
              professionalId: solo.id,
              allowReassign: false,
              idempotencyKey: `conc-${i}`,
            })
          )
        );
        const ok = attempts.filter((a) => a.status === "fulfilled");
        expect(ok.length).toBe(1);
        expect(await prismaRaw.appointment.count({ where: { organizationId: orgSolo } })).toBe(1);
      } finally {
        await prismaRaw.organization.delete({ where: { id: orgSolo } });
      }
    });

    it("idempotencyKey devolve o mesmo agendamento e não duplica", async () => {
      const { svc, prismaRaw } = m;
      const a = await svc.bookAppointment(orgId, { startAt: at("11:00", "2030-01-09"), durationMin: 30, idempotencyKey: "idem-1" });
      const b = await svc.bookAppointment(orgId, { startAt: at("11:00", "2030-01-09"), durationMin: 30, idempotencyKey: "idem-1" });
      expect(b).toMatchObject({ id: (a as { id: string }).id, idempotent: true });
      expect(await prismaRaw.appointment.count({ where: { organizationId: orgId, idempotencyKey: "idem-1" } })).toBe(1);
    });

    it("cancelar libera o horário; remarcar move e conta; falta exige atendimento passado", async () => {
      const { svc, prismaRaw } = m;
      const day = "2030-01-10";
      const a = (await svc.bookAppointment(orgId, { startAt: at("09:00", day), durationMin: 60, professionalId: proId })) as { id: string };
      const slotsBefore = await svc.getAvailability(orgId, { from: day, to: day, durationMin: 60, professionalId: proId, limit: 50 });
      expect(slotsBefore.slots.some((s) => s.start === at("09:00", day))).toBe(false);

      const moved = await svc.rescheduleAppointment(orgId, a.id, { startAt: at("10:00", day) });
      expect(moved.start).toBe(at("10:00", day));
      expect((await prismaRaw.appointment.findUniqueOrThrow({ where: { id: a.id } })).rescheduleCount).toBe(1);

      await svc.cancelAppointment(orgId, a.id, { reason: "teste" });
      expect(await svc.cancelAppointment(orgId, a.id)).toMatchObject({ idempotent: true });
      const slotsAfter = await svc.getAvailability(orgId, { from: day, to: day, durationMin: 60, professionalId: proId, limit: 50 });
      expect(slotsAfter.slots.some((s) => s.start === at("10:00", day))).toBe(true);

      await expect(svc.markNoShow(orgId, a.id)).rejects.toMatchObject({ code: "status_invalido" });
    });

    it("dados de uma organização não aparecem na disponibilidade de outra", async () => {
      const { svc } = m;
      const other = await svc.getAvailability(otherOrgId, { from: "2030-01-07", to: "2030-01-07", durationMin: 60 });
      expect(other.slots).toEqual([]); // outra org não tem profissionais
      await expect(svc.cancelAppointment(otherOrgId, "qualquer-id")).rejects.toMatchObject({ code: "agendamento_nao_encontrado" });
    });
  });

  // ── Catálogos ────────────────────────────────────────────────────────────
  describe("catálogos (tags, motivos de perda, itens)", () => {
    let cat: typeof import("@/lib/crm-catalog");
    beforeAll(async () => {
      cat = await import("@/lib/crm-catalog");
    });

    const tagsOf = async (id: string) =>
      JSON.parse((await m.prismaRaw.contact.findUniqueOrThrow({ where: { id } })).tags) as string[];

    it("etiquetas: catálogo nasce das já usadas, renomear propaga, apagar remove dos registros", async () => {
      const { prisma } = m;
      const tagOrg = (await m.prismaRaw.organization.create({ data: { name: "Tags", slug: `tags-${Date.now().toString(36)}` } })).id;
      try {
        const c1 = await prisma.contact.create({ data: { organizationId: tagOrg, name: "C1", tags: JSON.stringify(["VIP", "B2B"]) } });
        const c2 = await prisma.contact.create({ data: { organizationId: tagOrg, name: "C2", tags: JSON.stringify(["VIP"]) } });
        const c3 = await prisma.contact.create({ data: { organizationId: tagOrg, name: "C3", tags: JSON.stringify(["VIP2"]) } });

        const list = await cat.listTags(tagOrg); // primeira abertura: backfill
        expect(list.map((t) => t.name).sort()).toEqual(["B2B", "VIP", "VIP2"]);
        expect(list.find((t) => t.name === "VIP")?.contacts).toBe(2); // não conta "VIP2"

        const vip = list.find((t) => t.name === "VIP")!;
        await cat.updateTag(tagOrg, vip.id, { name: "Premium" });
        expect(await tagsOf(c1.id)).toEqual(["Premium", "B2B"]);
        expect(await tagsOf(c2.id)).toEqual(["Premium"]);
        expect(await tagsOf(c3.id)).toEqual(["VIP2"]); // intocado

        // renomear para um nome que já existe: recusa e não mexe nos registros
        const b2b = list.find((t) => t.name === "B2B")!;
        await expect(cat.updateTag(tagOrg, b2b.id, { name: "Premium" })).rejects.toMatchObject({ code: "etiqueta_existe" });
        expect(await tagsOf(c1.id)).toEqual(["Premium", "B2B"]);

        // apagar etiqueta tira de todos
        await cat.deleteTag(tagOrg, b2b.id);
        expect(await tagsOf(c1.id)).toEqual(["Premium"]);

        // contato na lixeira também é atualizado (restaurar não traz nome velho)
        await m.soft.softDeleteContacts(prisma, tagOrg, [c2.id]);
        const premium = (await cat.listTags(tagOrg)).find((t) => t.name === "Premium")!;
        await cat.updateTag(tagOrg, premium.id, { name: "Gold" });
        expect(await tagsOf(c2.id)).toEqual(["Gold"]);

        // isolamento: outra org não vê nem altera
        expect(await cat.listTags(otherOrgId)).toEqual([]);
        await expect(cat.updateTag(otherOrgId, premium.id, { name: "x" })).rejects.toMatchObject({ code: "etiqueta_nao_encontrada" });
      } finally {
        await m.prismaRaw.organization.delete({ where: { id: tagOrg } });
      }
    });

    it("syncTags cria só o que falta e ignora duplicadas e vazias", async () => {
      await cat.syncTags(orgId, ["Nova", " Nova ", "", "Outra"]);
      await cat.syncTags(orgId, ["Nova"]);
      const names = (await m.prismaRaw.tag.findMany({ where: { organizationId: orgId } })).map((t) => t.name);
      expect(names.filter((n) => n === "Nova")).toHaveLength(1);
      expect(names).toContain("Outra");
    });

    async function newOpp(title: string, org = orgId) {
      const { prisma, prismaRaw } = m;
      const c = await prisma.contact.create({ data: { organizationId: org, name: `Dono ${title}` } });
      const pl =
        (await prismaRaw.pipeline.findFirst({ where: { organizationId: org }, include: { stages: true } })) ??
        (await prismaRaw.pipeline.create({
          data: { organizationId: org, name: "P", stages: { create: [{ label: "Novo", color: "#000", order: 0 }] } },
          include: { stages: true },
        }));
      return prisma.opportunity.create({
        data: { organizationId: org, title, contactId: c.id, pipelineId: pl.id, stageId: pl.stages[0].id, value: 777 },
      });
    }

    it("motivos de perda: marcar, renomear propaga, usado só desativa, relatório agrupa", async () => {
      const { prismaRaw } = m;
      const r1 = await cat.createLossReason(orgId, { name: "Preço" });
      const r2 = await cat.createLossReason(orgId, { name: "Sem retorno" });
      await expect(cat.createLossReason(orgId, { name: "Preço" })).rejects.toMatchObject({ code: "motivo_existe" });

      const o1 = await newOpp("perdido 1");
      const o2 = await newOpp("perdido 2");
      const o3 = await newOpp("perdido 3");
      await cat.setOpportunityLossReason(orgId, o1.id, r1.id);
      await cat.setOpportunityLossReason(orgId, o2.id, r1.id);
      await cat.setOpportunityLossReason(orgId, o3.id, r2.id);
      expect((await prismaRaw.opportunity.findUniqueOrThrow({ where: { id: o1.id } })).lossReason).toBe("Preço");

      await cat.updateLossReason(orgId, r1.id, { name: "Preço alto" });
      expect((await prismaRaw.opportunity.findUniqueOrThrow({ where: { id: o2.id } })).lossReason).toBe("Preço alto");

      const report = await cat.lossReasonReport(orgId);
      expect(report.find((r) => r.name === "Preço alto")).toMatchObject({ count: 2, totalValue: 1554 });

      expect(await cat.deleteLossReason(orgId, r1.id)).toMatchObject({ deactivated: true, usedBy: 2 });
      expect((await cat.listLossReasons(orgId)).map((r) => r.name)).not.toContain("Preço alto");
      await expect(cat.setOpportunityLossReason(orgId, o1.id, r1.id)).rejects.toMatchObject({ code: "motivo_nao_encontrado" });

      const livre = await cat.createLossReason(orgId, { name: "Nunca usado" });
      expect(await cat.deleteLossReason(orgId, livre.id)).toMatchObject({ deactivated: false });

      // outra organização não usa motivo daqui
      const alheia = await newOpp("alheia", otherOrgId);
      await expect(cat.setOpportunityLossReason(otherOrgId, alheia.id, r2.id)).rejects.toMatchObject({ code: "motivo_nao_encontrado" });
    });

    it("itens do negócio: valor vira a soma (qtd × unitário − desconto), com validações", async () => {
      const { prismaRaw } = m;
      const botox = await m.catalog.createProcedure(orgId, { name: "Botox", priceCents: 120_000, kind: "PROCEDURE" } as never);
      const opp = await newOpp("com itens");

      const a = await cat.addItem(orgId, opp.id, { procedureId: botox.id, quantity: 2, discountCents: 10_000 });
      expect(a.totalCents).toBe(230_000); // 2 × 1200,00 − 100,00
      expect((await prismaRaw.opportunity.findUniqueOrThrow({ where: { id: opp.id } })).value).toBe(2300);
      expect(a.item).toMatchObject({ name: "Botox", unitCents: 120_000 });

      const b = await cat.addItem(orgId, opp.id, { name: "Creme pós-procedimento", unitCents: 8_990 });
      expect(b.totalCents).toBe(238_990);

      const upd = await cat.updateItem(orgId, opp.id, a.item.id, { quantity: 1, discountCents: 0 });
      expect(upd.totalCents).toBe(120_000 + 8_990);

      await expect(cat.updateItem(orgId, opp.id, a.item.id, { discountCents: 999_999_999 })).rejects.toMatchObject({ code: "desconto_invalido" });
      await expect(cat.addItem(orgId, opp.id, { name: "x", quantity: 0 })).rejects.toMatchObject({ code: "quantidade_invalida" });
      await expect(cat.addItem(orgId, opp.id, {})).rejects.toMatchObject({ code: "nome_invalido" });

      const del = await cat.removeItem(orgId, opp.id, b.item.id);
      expect(del.totalCents).toBe(120_000);
      expect((await cat.listItems(orgId, opp.id)).items).toHaveLength(1);

      // sem itens o valor digitado à mão é preservado
      await cat.removeItem(orgId, opp.id, a.item.id);
      expect((await prismaRaw.opportunity.findUniqueOrThrow({ where: { id: opp.id } })).value).toBe(1200);

      // isolamento
      await expect(cat.addItem(otherOrgId, opp.id, { name: "x" })).rejects.toMatchObject({ code: "negocio_nao_encontrado" });
      await expect(cat.listItems(otherOrgId, opp.id)).rejects.toMatchObject({ code: "negocio_nao_encontrado" });
    });
  });

  // ── Consultas paginadas / agregadas ──────────────────────────────────────
  describe("consultas paginadas e agregadas", () => {
    let q: typeof import("@/lib/queries");
    let msgs: typeof import("@/lib/messages");
    let data: typeof import("@/lib/data");
    let qOrg: string;
    let qOrg2: string;
    let ownerA: string;
    let ownerB: string;
    let stageA: string;
    let stageB: string;
    let pipelineId: string;
    const contactIds: string[] = [];
    const T0 = Date.UTC(2030, 0, 1, 12, 0, 0);

    beforeAll(async () => {
      q = await import("@/lib/queries");
      msgs = await import("@/lib/messages");
      data = await import("@/lib/data");
      const { prismaRaw } = m;
      const tag = Date.now().toString(36);
      qOrg = (await prismaRaw.organization.create({ data: { name: "Q", slug: `q-${tag}` } })).id;
      qOrg2 = (await prismaRaw.organization.create({ data: { name: "Q2", slug: `q2-${tag}` } })).id;
      ownerA = (await prismaRaw.user.create({ data: { organizationId: qOrg, name: "A", email: `a-${tag}@t.com`, passwordHash: "x" } })).id;
      ownerB = (await prismaRaw.user.create({ data: { organizationId: qOrg, name: "B", email: `b-${tag}@t.com`, passwordHash: "x" } })).id;

      // 120 contatos, criados com 1 s de diferença (ordem determinística)
      await prismaRaw.contact.createMany({
        data: Array.from({ length: 120 }, (_, i) => ({
          id: `qc-${tag}-${String(i).padStart(3, "0")}`,
          organizationId: qOrg,
          name: `Paciente ${String(i).padStart(3, "0")}`,
          phone: `1199${String(i).padStart(6, "0")}`,
          email: `p${i}@clinica.com`,
          tags: i % 10 === 0 ? JSON.stringify(["VIP"]) : "[]",
          ownerId: i % 2 === 0 ? ownerA : ownerB,
          createdAt: new Date(T0 + i * 1000),
        })),
      });
      contactIds.push(...Array.from({ length: 120 }, (_, i) => `qc-${tag}-${String(i).padStart(3, "0")}`));

      const pl = await prismaRaw.pipeline.create({
        data: {
          organizationId: qOrg,
          name: "Funil",
          stages: { create: [{ label: "Novo", color: "#000", order: 0 }, { label: "Ganho", color: "#0a0", order: 1 }] },
        },
        include: { stages: true },
      });
      pipelineId = pl.id;
      stageA = pl.stages.find((s) => s.label === "Novo")!.id;
      stageB = pl.stages.find((s) => s.label === "Ganho")!.id;
    });

    it("contatos: percorre todas as páginas sem repetir nem perder, total só na primeira", async () => {
      const seen: string[] = [];
      let cursor: string | undefined;
      const sizes: number[] = [];
      let firstTotal: number | null = null;
      for (let guard = 0; guard < 10; guard++) {
        const page = await q.getContactsPage(qOrg, { limit: 50, cursor });
        if (!cursor) firstTotal = page.total;
        else expect(page.total).toBeNull();
        sizes.push(page.items.length);
        seen.push(...page.items.map((c) => c.id));
        if (!page.nextCursor) break;
        cursor = page.nextCursor;
      }
      expect(sizes).toEqual([50, 50, 20]);
      expect(firstTotal).toBe(120);
      expect(new Set(seen).size).toBe(120);
      expect(seen[0]).toBe(contactIds[119]); // mais novo primeiro
      expect(seen[119]).toBe(contactIds[0]);
    });

    it("contatos: busca no servidor (nome, e-mail, telefone com e sem máscara), filtros e isolamento", async () => {
      const byName = await q.getContactsPage(qOrg, { q: "paciente 007" });
      expect(byName.items.map((c) => c.name)).toEqual(["Paciente 007"]);

      expect((await q.getContactsPage(qOrg, { q: "P42@CLINICA.COM" })).items).toHaveLength(1);
      expect((await q.getContactsPage(qOrg, { q: "(11) 99-000005" })).items.map((c) => c.name)).toEqual(["Paciente 005"]);
      expect((await q.getContactsPage(qOrg, { q: "1199000005" })).items).toHaveLength(1);

      // texto com letras NÃO vira busca por dígitos de telefone: "Paciente 007" acha só o 007
      // (e não todo telefone que contém "007")
      const withLetters = await q.getContactsPage(qOrg, { q: "Paciente 007" });
      expect(withLetters.items.map((c) => c.name)).toEqual(["Paciente 007"]);

      const vip = await q.getContactsPage(qOrg, { tag: "VIP", limit: 100 });
      expect(vip.total).toBe(12);
      expect(vip.items.every((c) => c.tags.includes("VIP"))).toBe(true);

      const mine = await q.getContactsPage(qOrg, { ownerId: ownerA, limit: 100 });
      expect(mine.total).toBe(60);

      expect((await q.getContactsPage(qOrg2, { q: "Paciente" })).items).toEqual([]);

      const some = await q.getContactsPage(qOrg, { ids: [contactIds[3], contactIds[4], "inexistente"] });
      expect(some.items.map((c) => c.id).sort()).toEqual([contactIds[3], contactIds[4]].sort());
    });

    it("contatos: apagado não aparece; contagem de negócios por contato", async () => {
      const { prisma, prismaRaw, soft } = m;
      await prisma.opportunity.create({
        data: { organizationId: qOrg, title: "N1", contactId: contactIds[10], pipelineId, stageId: stageA, value: 100 },
      });
      await prisma.opportunity.create({
        data: { organizationId: qOrg, title: "N2", contactId: contactIds[10], pipelineId, stageId: stageA, value: 50 },
      });
      const row = (await q.getContactsPage(qOrg, { q: "Paciente 010" })).items[0];
      expect(row.dealsCount).toBe(2);

      const temp = await prismaRaw.contact.create({ data: { organizationId: qOrg, name: "Zé Temporário" } });
      expect((await q.getContactsPage(qOrg, { q: "Zé Temporário" })).items).toHaveLength(1);
      await soft.softDeleteContacts(prisma, qOrg, [temp.id]);
      expect((await q.getContactsPage(qOrg, { q: "Zé Temporário" })).items).toHaveLength(0);
      expect(await q.searchContacts(qOrg, "Zé Temporário")).toHaveLength(0);
    });

    it("typeahead e busca por ids respeitam a organização", async () => {
      expect((await q.searchContacts(qOrg, "paciente 03", 5)).length).toBeLessThanOrEqual(5);
      expect(await q.searchContacts(qOrg2, "Paciente")).toEqual([]);
      expect(await q.getContactsByIds(qOrg2, [contactIds[0]])).toEqual([]);
      expect((await q.getContactsByIds(qOrg, [contactIds[0], contactIds[0]])).length).toBe(1);
    });

    it("conversas: ordenadas pela última mensagem, paginadas por cursor, sem regredir o resumo", async () => {
      const { prismaRaw, prisma } = m;
      // 5 contatos com mensagens em horários diferentes (fora de ordem de criação)
      const order = [contactIds[20], contactIds[21], contactIds[22], contactIds[23], contactIds[24]];
      const times = [3, 5, 1, 4, 2]; // minutos após T0
      for (let i = 0; i < order.length; i++) {
        await msgs.createMessage(prisma, {
          organizationId: qOrg,
          contactId: order[i],
          text: `msg ${i}`,
          direction: "in",
          time: new Date(T0 + times[i] * 60_000),
        });
      }
      // reentrega de mensagem ANTIGA não pode sobrescrever o resumo
      await msgs.createMessage(prisma, {
        organizationId: qOrg, contactId: order[1], text: "antiga", direction: "out", time: new Date(T0 + 10_000),
      });
      const c = await prismaRaw.contact.findUniqueOrThrow({ where: { id: order[1] } });
      expect(c.lastMessageText).toBe("msg 1");
      expect(c.lastMessageAt?.getTime()).toBe(T0 + 5 * 60_000); // round-trip de fuso exato

      const seen: string[] = [];
      let cursor: string | undefined;
      for (let guard = 0; guard < 10; guard++) {
        const page = await q.getConversationsPage(qOrg, { limit: 2, cursor });
        seen.push(...page.items.map((r) => r.contact.id));
        if (!page.nextCursor) break;
        cursor = page.nextCursor;
      }
      // por tempo desc: 5(c21), 4(c23), 3(c20), 2(c24), 1(c22)
      expect(seen).toEqual([order[1], order[3], order[0], order[4], order[2]]);

      const first = (await q.getConversationsPage(qOrg, { limit: 1 })).items[0];
      expect(first).toMatchObject({ lastText: "msg 1", lastDirection: "in" });
      expect(first.lastTime).toBe(new Date(T0 + 5 * 60_000).toISOString());
    });

    it("conversas: membro só vê as dele; busca só acha atendimentos reais; org isolada", async () => {
      // contactIds[20..24]: pares → ownerA (20,22,24), ímpares → ownerB (21,23)
      const mineA = await q.getConversationsPage(qOrg, { restrictToOwnerId: ownerA });
      expect(mineA.items.map((r) => r.contact.id).sort()).toEqual([contactIds[20], contactIds[22], contactIds[24]].sort());

      // a lista é de ATENDIMENTOS (contato + canal, com mensagem): contato sem conversa não aparece
      expect((await q.getConversationsPage(qOrg, { q: "Paciente 100" })).items).toEqual([]);
      const found = await q.getConversationsPage(qOrg, { q: "Paciente 020" });
      expect(found.items.map((r) => r.contact.name)).toEqual(["Paciente 020"]);

      expect((await q.getConversationsPage(qOrg2)).items).toEqual([]);
    });

    // Regressão de segurança: o filtro de responsável vem do navegador. Antes ele
    // sobrescrevia a restrição do atendente comum, e dava para ler conversa de colega.
    it("conversas: a restrição do atendente comum NÃO pode ser sobrescrita pelo filtro de responsável", async () => {
      // ownerB tem os contatos ímpares (21, 23); ownerA pede "ownerId: ownerB"
      const hijack = await q.getConversationsPage(qOrg, { restrictToOwnerId: ownerA, ownerId: ownerB });
      expect(hijack.items).toEqual([]);
      const same = await q.getConversationsPage(qOrg, { restrictToOwnerId: ownerA, ownerId: ownerA });
      expect(same.items).toHaveLength(3);
      // sem restrição (administrador) o filtro funciona normalmente
      const admin = await q.getConversationsPage(qOrg, { ownerId: ownerB });
      expect(admin.items.map((r) => r.contact.id).sort()).toEqual([contactIds[21], contactIds[23]].sort());
    });

    it("conversas: filtros combinados (tag + busca) valem juntos, não um apaga o outro", async () => {
      const { prismaRaw } = m;
      await prismaRaw.contact.update({ where: { id: contactIds[20] }, data: { tags: JSON.stringify(["Retorno"]) } });
      await prismaRaw.contact.update({ where: { id: contactIds[21] }, data: { tags: JSON.stringify(["Retorno"]) } });
      const both = await q.getConversationsPage(qOrg, { tag: "Retorno", q: "Paciente 020" });
      expect(both.items.map((r) => r.contact.name)).toEqual(["Paciente 020"]); // tag casa nos dois, a busca só em um
      const onlyTag = await q.getConversationsPage(qOrg, { tag: "Retorno" });
      expect(onlyTag.items).toHaveLength(2);
      expect((await q.getConversationsPage(qOrg, { tag: "Retor" })).items).toEqual([]); // tag exata, não pedaço
    });

    it("mensagens: página mais recente em ordem cronológica, cursor traz as anteriores; membro alheio bloqueado", async () => {
      const { prismaRaw } = m;
      const cid = contactIds[50];
      await prismaRaw.message.createMany({
        data: Array.from({ length: 130 }, (_, i) => ({
          id: `qm-${cid}-${String(i).padStart(3, "0")}`,
          organizationId: qOrg,
          contactId: cid,
          text: `m${i}`,
          direction: "in",
          time: new Date(T0 + i * 1000),
        })),
      });
      const admin = { id: "qualquer", role: "ADMIN" as const };

      const p1 = (await q.getMessagesPage(qOrg, admin, cid, { limit: 50 }))!;
      expect(p1.items).toHaveLength(50);
      expect(p1.items[0].text).toBe("m80"); // cronológico: a mais antiga da página primeiro
      expect(p1.items[49].text).toBe("m129");
      expect(p1.nextCursor).toBeTruthy();

      const p2 = (await q.getMessagesPage(qOrg, admin, cid, { limit: 50, cursor: p1.nextCursor! }))!;
      expect(p2.items[49].text).toBe("m79");
      const p3 = (await q.getMessagesPage(qOrg, admin, cid, { limit: 50, cursor: p2.nextCursor! }))!;
      expect(p3.items).toHaveLength(30);
      expect(p3.nextCursor).toBeNull();

      // contactIds[50] é par → ownerA; ownerB (membro) não pode ler
      expect(await q.getMessagesPage(qOrg, { id: ownerB, role: "MEMBER" }, cid)).toBeNull();
      expect(await q.getMessagesPage(qOrg, { id: ownerA, role: "MEMBER" }, cid)).not.toBeNull();
      expect(await q.getMessagesPage(qOrg2, admin, cid)).toBeNull(); // outra org

      const detailOther = (await q.getContactDetail(qOrg, { id: ownerB, role: "MEMBER" }, cid))!;
      expect(detailOther.conversationHidden).toBe(true);
      expect(detailOther.messages).toEqual([]);
      const detailAdmin = (await q.getContactDetail(qOrg, admin, cid))!;
      expect(detailAdmin.conversationHidden).toBe(false);
      expect(detailAdmin.messages).toHaveLength(100);
      expect(await q.getContactDetail(qOrg2, admin, cid)).toBeNull();
    });

    it("pipeline: resumo por etapa e cartões paginados, sem o que está na lixeira", async () => {
      const { prisma, prismaRaw } = m;
      const base = { organizationId: qOrg, pipelineId, stageId: stageB };
      await prismaRaw.opportunity.createMany({
        data: Array.from({ length: 70 }, (_, i) => ({
          ...base,
          id: `qo-${stageB}-${String(i).padStart(3, "0")}`,
          title: `Neg ${i}`,
          contactId: contactIds[i],
          value: 10,
          ownerId: i % 2 === 0 ? ownerA : ownerB,
          createdAt: new Date(T0 + i * 1000),
        })),
      });
      const before = (await q.getStageSummaries(qOrg, pipelineId)).find((s) => s.stageId === stageB)!;
      expect(before).toMatchObject({ count: 70, sum: 700 });

      const sizes: number[] = [];
      const seen: string[] = [];
      let cursor: string | undefined;
      for (let guard = 0; guard < 10; guard++) {
        const page = await q.getStageCards(qOrg, stageB, { limit: 30, cursor });
        sizes.push(page.items.length);
        seen.push(...page.items.map((c) => c.id));
        expect(page.items.every((c) => c.contactName?.startsWith("Paciente"))).toBe(true);
        if (!page.nextCursor) break;
        cursor = page.nextCursor;
      }
      expect(sizes).toEqual([30, 30, 10]);
      expect(new Set(seen).size).toBe(70);

      expect((await q.getStageCards(qOrg, stageB, { q: "Paciente 003" })).items.map((c) => c.title)).toEqual(["Neg 3"]);
      expect((await q.getStageCards(qOrg, stageB, { ownerId: ownerA, limit: 100 })).items.length).toBe(35);

      await m.soft.softDeleteOpportunity(prisma, qOrg, `qo-${stageB}-000`);
      const after = (await q.getStageSummaries(qOrg, pipelineId)).find((s) => s.stageId === stageB)!;
      expect(after).toMatchObject({ count: 69, sum: 690 });

      expect(await q.getStageSummaries(qOrg2, pipelineId)).toEqual([]);
      expect((await q.getStageCards(qOrg2, stageB)).items).toEqual([]);
      expect((await q.searchOpportunities(qOrg, "Neg 5")).length).toBeGreaterThan(0);
      expect(await q.searchOpportunities(qOrg2, "Neg")).toEqual([]);
      expect(await q.getOpportunitiesByIds(qOrg2, [`qo-${stageB}-001`])).toEqual([]);
    });

    it("dashboard: totais por etapa/mês/atendente e tempo médio por etapa (SQL agregado)", async () => {
      const { prismaRaw } = m;
      const dOrg = (await prismaRaw.organization.create({ data: { name: "D", slug: `d-${Date.now().toString(36)}` } })).id;
      try {
        const u = await prismaRaw.user.create({ data: { organizationId: dOrg, name: "U", email: `u-${Date.now()}@t.com`, passwordHash: "x" } });
        const c = await prismaRaw.contact.create({ data: { organizationId: dOrg, name: "C" } });
        const pl = await prismaRaw.pipeline.create({
          data: { organizationId: dOrg, name: "P", stages: { create: [{ label: "Novo", color: "#000", order: 0 }, { label: "Ganho", color: "#0a0", order: 1 }] } },
          include: { stages: true },
        });
        const [sNovo, sGanho] = [pl.stages.find((s) => s.label === "Novo")!.id, pl.stages.find((s) => s.label === "Ganho")!.id];
        const mk = (title: string, stageId: string, value: number, createdAt: string, ownerId: string | null) =>
          prismaRaw.opportunity.create({
            data: { organizationId: dOrg, title, contactId: c.id, pipelineId: pl.id, stageId, value, createdAt: new Date(createdAt), ownerId },
          });
        const o1 = await mk("a", sNovo, 100, "2029-11-15T12:00:00Z", u.id);
        await mk("b", sGanho, 300, "2029-11-20T12:00:00Z", u.id);
        await mk("c", sNovo, 50, "2029-12-05T12:00:00Z", null);
        const lixo = await mk("lixo", sNovo, 9999, "2029-12-06T12:00:00Z", u.id);
        await prismaRaw.opportunity.update({ where: { id: lixo.id }, data: { deletedAt: new Date() } });

        // histórico: 2 passagens por "Novo" (1 dia e 3 dias → média 2 dias) + 1 aberta (ignorada) + 1 de negócio apagado (ignorada)
        const day = 86_400_000;
        const h = (opportunityId: string, enteredAt: number, exitedAt: number | null) =>
          prismaRaw.opportunityStageHistory.create({
            data: { organizationId: dOrg, opportunityId, stageId: sNovo, enteredAt: new Date(enteredAt), exitedAt: exitedAt ? new Date(exitedAt) : null },
          });
        await h(o1.id, T0, T0 + day);
        await h(o1.id, T0, T0 + 3 * day);
        await h(o1.id, T0, null);
        await h(lixo.id, T0, T0 + 100 * day);

        const agg = await q.getDashboardAggregates(dOrg);
        const novo = agg.stageTotals.find((s) => s.stageId === sNovo)!;
        expect(novo).toMatchObject({ count: 2, sum: 150 }); // exclui o apagado
        expect(agg.stageTotals.find((s) => s.stageId === sGanho)).toMatchObject({ count: 1, sum: 300 });

        const monthly = Object.fromEntries(agg.monthly.map((r) => [`${r.month}|${r.stageId === sGanho ? "g" : "n"}`, r.sum]));
        expect(monthly).toEqual({ "2029-11|n": 100, "2029-11|g": 300, "2029-12|n": 50 });

        const own = Object.fromEntries(agg.ownerTotals.map((r) => [r.ownerId ?? "none", r.sum]));
        expect(own[u.id]).toBe(400);
        expect(own.none).toBe(50);

        expect(agg.stageSpeed).toHaveLength(1);
        expect(agg.stageSpeed[0]).toMatchObject({ stageId: sNovo, count: 2 });
        expect(agg.stageSpeed[0].avgMs).toBeCloseTo(2 * day, -3);

        const stats = await q.getOwnerStats(dOrg);
        expect(stats.dealsByOwnerStage.find((d) => d.ownerId === u.id && d.stageId === sGanho)).toMatchObject({ count: 1, sum: 300 });
        expect((await q.getDashboardAggregates(qOrg2)).stageTotals).toEqual([]); // org sem negócios
      } finally {
        await prismaRaw.organization.delete({ where: { id: dOrg } });
      }
    });

    it("duplicados: SQL agrupa e-mail sem diferenciar caixa e telefone sem máscara; ignora lixeira e outras orgs", async () => {
      const { prisma, prismaRaw, soft } = m;
      const dupOrg = (await prismaRaw.organization.create({ data: { name: "Dup", slug: `dup-${Date.now().toString(36)}` } })).id;
      try {
        const mk = (name: string, email: string | null, phone: string | null, org = dupOrg) =>
          prisma.contact.create({ data: { organizationId: org, name, email, phone } });
        const a = await mk("Ana", "Ana@Example.com", "(11) 90000-0000");
        const b = await mk("Ana P.", " ana@example.com ", "11900000000");
        await mk("Outro", "outro@example.com", "21955550000");
        const lixo = await mk("Ana lixo", "ana@example.com", null);
        await soft.softDeleteContacts(prisma, dupOrg, [lixo.id]);
        await mk("Ana de outra org", "ana@example.com", "11900000000", otherOrgId);
        await mk("Sem dados", null, null);
        await mk("Vazio", "", "abc");

        const groups = await data.findDuplicateContacts(dupOrg);
        const email = groups.find((g) => g.matchedOn === "email")!;
        const phone = groups.find((g) => g.matchedOn === "phone")!;
        expect(groups).toHaveLength(2);
        expect(email.key).toBe("email:ana@example.com");
        expect(email.contacts.map((c) => c.id).sort()).toEqual([a.id, b.id].sort());
        expect(phone.key).toBe("phone:11900000000");
        expect(phone.contacts).toHaveLength(2);
      } finally {
        await prismaRaw.organization.delete({ where: { id: dupOrg } });
      }
    });

    it("backfill do resumo da última mensagem é idempotente", async () => {
      const { prismaRaw } = m;
      const bOrg = (await prismaRaw.organization.create({ data: { name: "BF", slug: `bf-${Date.now().toString(36)}` } })).id;
      try {
        const c1 = await prismaRaw.contact.create({ data: { organizationId: bOrg, name: "Com msgs" } });
        const c2 = await prismaRaw.contact.create({ data: { organizationId: bOrg, name: "Sem msgs" } });
        const mk = (text: string, direction: string, t: number) =>
          prismaRaw.message.create({ data: { organizationId: bOrg, contactId: c1.id, text, direction, time: new Date(T0 + t) } });
        await mk("primeira", "in", 0);
        await mk("última", "out", 5000);
        await mk("meio", "in", 2000);

        const n = await q.backfillLastMessages();
        expect(n).toBeGreaterThanOrEqual(1);
        const r1 = await prismaRaw.contact.findUniqueOrThrow({ where: { id: c1.id } });
        expect(r1).toMatchObject({ lastMessageText: "última", lastMessageDirection: "out" });
        expect(r1.lastMessageAt?.getTime()).toBe(T0 + 5000);
        expect((await prismaRaw.contact.findUniqueOrThrow({ where: { id: c2.id } })).lastMessageAt).toBeNull();

        expect(await q.backfillLastMessages()).toBe(0);
      } finally {
        await prismaRaw.organization.delete({ where: { id: bOrg } });
      }
    });

    it("lista salva (segmento) filtra no banco: tag exata, responsável, campo extra, datas, AND", async () => {
      const { prismaRaw } = m;
      const seg = await import("@/lib/segments");
      const sOrg = (await prismaRaw.organization.create({ data: { name: "S", slug: `s-${Date.now().toString(36)}` } })).id;
      try {
        const u = await prismaRaw.user.create({ data: { organizationId: sOrg, name: "U", email: `su-${Date.now()}@t.com`, passwordHash: "x" } });
        const mk = (name: string, over: Record<string, unknown> = {}) =>
          prismaRaw.contact.create({ data: { organizationId: sOrg, name, ...over } });
        const vip = await mk("Vip", { tags: JSON.stringify(["VIP"]), ownerId: u.id, customFields: { idade: 30, ativo: true, cidade: "Joinville" }, createdAt: new Date("2030-03-10T12:00:00Z") });
        await mk("Vip2", { tags: JSON.stringify(["VIP2"]), ownerId: u.id });
        const semDono = await mk("SemDono", { tags: JSON.stringify(["VIP"]), createdAt: new Date("2030-01-01T12:00:00Z") });
        const antigo = await mk("Antigo", { customFields: { idade: "30" }, createdAt: new Date("2020-01-01T12:00:00Z") });
        const eval_ = async (conditions: unknown[]) =>
          (await seg.evaluateSegment(sOrg, "CONTACT", JSON.stringify({ conditions }))).map((r) => r.id).sort();

        expect(await eval_([{ field: "tag", value: "VIP" }])).toEqual([vip.id, semDono.id].sort()); // não casa "VIP2"
        expect(await eval_([{ field: "owner", value: u.id }])).toHaveLength(2);
        expect(await eval_([{ field: "owner", value: null }])).toEqual([semDono.id, antigo.id].sort());
        expect(await eval_([{ field: "tag", value: "VIP" }, { field: "owner", value: u.id }])).toEqual([vip.id]);

        // campo extra: texto, número e booleano guardados no JSON, criterio chega como texto
        expect(await eval_([{ field: "customField", key: "cidade", value: "Joinville" }])).toEqual([vip.id]);
        expect(await eval_([{ field: "customField", key: "idade", value: "30" }])).toEqual([vip.id, antigo.id].sort()); // 30 (número) e "30" (texto)
        expect(await eval_([{ field: "customField", key: "ativo", value: "true" }])).toEqual([vip.id]);

        // Vip e SemDono foram criados em 2030; Vip2 "agora" (2026) e Antigo em 2020 ficam de fora
        expect(await eval_([{ field: "createdAfter", value: "2030-01-01T00:00:00Z" }, { field: "createdBefore", value: "2030-12-31T00:00:00Z" }]))
          .toEqual([vip.id, semDono.id].sort());
        expect(await eval_([{ field: "createdBefore", value: "2021-01-01T00:00:00Z" }])).toEqual([antigo.id]);
        expect(await eval_([])).toHaveLength(4); // sem critérios: todos

        // paginado pelo servidor junto com busca
        const filters = JSON.stringify({ conditions: [{ field: "tag", value: "VIP" }] });
        const page = await q.getContactsPage(sOrg, { extraWhere: seg.segmentWhere(filters) as never, limit: 1 });
        expect(page.total).toBe(2);
        expect(page.items).toHaveLength(1);
        expect(page.nextCursor).toBeTruthy();

        // outra org não enxerga
        expect(await seg.evaluateSegment(qOrg2, "CONTACT", filters)).toEqual([]);
      } finally {
        await prismaRaw.organization.delete({ where: { id: sOrg } });
      }
    });

    it("chave da API: localizada por hash, rotação invalida a antiga, chave legada é migrada no primeiro uso", async () => {
      const { prismaRaw } = m;
      const mcp = await import("@/lib/mcp-config");
      const { encryptJson } = await import("@/lib/crypto");
      const kOrg = (await prismaRaw.organization.create({ data: { name: "K", slug: `k-${Date.now().toString(36)}` } })).id;
      const legacyOrg = (await prismaRaw.organization.create({ data: { name: "KL", slug: `kl-${Date.now().toString(36)}` } })).id;
      try {
        const key = await mcp.getOrCreateMcpApiKey(kOrg);
        expect(key).toMatch(/^mcp_[0-9a-f]{48}$/);
        expect(await mcp.getOrCreateMcpApiKey(kOrg)).toBe(key); // estável
        expect((await prismaRaw.mcpConfig.findUniqueOrThrow({ where: { organizationId: kOrg } })).apiKeyHash).toBe(mcp.hashApiKey(key));
        expect(await mcp.resolveOrgByMcpApiKey(key)).toBe(kOrg);
        expect(await mcp.resolveOrgByMcpApiKey("mcp_errada")).toBeNull();
        expect(await mcp.resolveOrgByMcpApiKey("")).toBeNull();

        const novo = await mcp.regenerateMcpApiKey(kOrg);
        expect(novo).not.toBe(key);
        expect(await mcp.resolveOrgByMcpApiKey(key)).toBeNull(); // a antiga parou de valer
        expect(await mcp.resolveOrgByMcpApiKey(novo)).toBe(kOrg);

        // chave criada antes do hash existir (apiKeyHash nulo)
        const legacyKey = "mcp_legada_de_teste_123";
        await prismaRaw.mcpConfig.create({ data: { organizationId: legacyOrg, apiKey: encryptJson(legacyKey) } });
        expect(await mcp.resolveOrgByMcpApiKey(legacyKey)).toBe(legacyOrg);
        expect((await prismaRaw.mcpConfig.findUniqueOrThrow({ where: { organizationId: legacyOrg } })).apiKeyHash).toBe(mcp.hashApiKey(legacyKey));
        expect(await mcp.resolveOrgByMcpApiKey(legacyKey)).toBe(legacyOrg); // agora pelo caminho rápido
        expect(await mcp.resolveOrgByMcpApiKey("mcp_legada_de_teste_124")).toBeNull();
      } finally {
        await prismaRaw.organization.deleteMany({ where: { id: { in: [kOrg, legacyOrg] } } });
      }
    });

    afterAll(async () => {
      await m.prismaRaw.organization.deleteMany({ where: { id: { in: [qOrg, qOrg2] } } });
    });
  });

  // ── Auditoria ────────────────────────────────────────────────────────────
  describe("auditoria", () => {
    it("registrou as operações e pagina por cursor", async () => {
      const { audit } = m;
      const all = await audit.listAuditLogs(orgId, { limit: 100 });
      expect(all.items.length).toBeGreaterThan(5);
      expect(all.items.some((i) => i.action === "appointment.created")).toBe(true);
      expect(all.items.some((i) => i.action === "contact.restored")).toBe(true);

      const p1 = await audit.listAuditLogs(orgId, { limit: 3 });
      expect(p1.items.length).toBe(3);
      expect(p1.nextCursor).toBeTruthy();
      const p2 = await audit.listAuditLogs(orgId, { limit: 3, cursor: p1.nextCursor! });
      expect(p2.items.length).toBeGreaterThan(0);
      expect(p2.items.map((i) => i.id)).not.toContain(p1.items[0].id);

      const byAction = await audit.listAuditLogs(orgId, { action: "appointment." });
      expect(byAction.items.every((i) => i.action.startsWith("appointment."))).toBe(true);

      expect((await audit.listAuditLogs(otherOrgId)).items).toEqual([]);
    });
  });
});
