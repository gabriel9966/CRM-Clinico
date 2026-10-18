import "server-only";
import { prisma, prismaRaw } from "./prisma";
import { writeAudit, type AuditEntry } from "./audit";
import { AppError } from "./errors";

// Catálogos gerenciáveis do CRM: etiquetas, motivos de perda e itens (produtos/
// procedimentos) de um negócio. Tudo isolado por organizationId.

type Actor = Pick<AuditEntry, "actorId" | "actorName">;

const normalize = (s: string) => s.trim().replace(/\s+/g, " ");

function parseTags(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((t): t is string => typeof t === "string") : [];
  } catch {
    return [];
  }
}

function isUniqueViolation(err: unknown) {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "P2002";
}

// ── Etiquetas ───────────────────────────────────────────────────────────────

export type TagDTO = { id: string; name: string; color: string; description: string; appliesToContacts: boolean; appliesToOpportunities: boolean; contacts: number; opportunities: number };

/**
 * Garante que cada nome usado em contatos/negócios exista no catálogo. Chamado
 * ao salvar contatos, importar CSV e por automações — o catálogo se mantém
 * completo sem o usuário cadastrar tudo à mão.
 */
export type TagTarget = "contact" | "opportunity";

/** Mantém o catálogo e, quando há alvo, impede associar uma tag fora do
 * escopo definido pelo administrador. Esta é a única porta de entrada para
 * tags criadas por telas, importações, webhooks e automações. */
export async function syncTags(organizationId: string, names: string[], target?: TagTarget) {
  const clean = [...new Set(names.map(normalize).filter((n) => n && n.length <= 50))];
  if (clean.length === 0) return;
  const existing = await prismaRaw.tag.findMany({ where: { organizationId, name: { in: clean } } });
  const byName = new Map(existing.map((tag) => [tag.name, tag]));
  const invalid = clean.find((name) => {
    const tag = byName.get(name);
    return tag && target === "contact" ? !tag.appliesToContacts : tag && target === "opportunity" ? !tag.appliesToOpportunities : false;
  });
  if (invalid) throw new AppError("escopo_tag_invalido", `a tag "${invalid}" não pode ser usada neste tipo de registro`, 400);
  await prismaRaw.tag.createMany({
    data: clean.filter((name) => !byName.has(name)).map((name) => ({
      organizationId,
      name,
      appliesToContacts: target !== "opportunity",
      appliesToOpportunities: target !== "contact",
    })),
    skipDuplicates: true,
  });
}

// Primeira abertura do catálogo numa organização que já tinha etiquetas
// soltas nos contatos: cria as linhas de Tag a partir do que existe.
async function backfillTags(organizationId: string) {
  const names = new Set<string>();
  for (const model of [prismaRaw.contact, prismaRaw.opportunity] as const) {
    const rows = await (model as typeof prismaRaw.contact).findMany({
      where: { organizationId, NOT: { tags: "[]" } },
      select: { tags: true },
      take: 20_000,
    });
    for (const r of rows) parseTags(r.tags).forEach((t) => names.add(t));
  }
  await syncTags(organizationId, [...names]);
}

export async function listTags(organizationId: string, target?: "contact" | "opportunity"): Promise<TagDTO[]> {
  if ((await prismaRaw.tag.count({ where: { organizationId } })) === 0) await backfillTags(organizationId);

  const tags = await prismaRaw.tag.findMany({
    where: { organizationId, ...(target === "contact" ? { appliesToContacts: true } : target === "opportunity" ? { appliesToOpportunities: true } : {}) },
    orderBy: { name: "asc" },
  });
  return Promise.all(
    tags.map(async (t) => {
      const token = JSON.stringify(t.name); // "VIP" com aspas: não casa com "VIP2"
      const [contacts, opportunities] = await Promise.all([
        prisma.contact.count({ where: { organizationId, tags: { contains: token } } }),
        prisma.opportunity.count({ where: { organizationId, tags: { contains: token } } }),
      ]);
      return { id: t.id, name: t.name, color: t.color, description: t.description ?? "", appliesToContacts: t.appliesToContacts, appliesToOpportunities: t.appliesToOpportunities, contacts, opportunities };
    })
  );
}

export async function createTag(organizationId: string, input: { name: string; color?: string; description?: string; appliesToContacts?: boolean; appliesToOpportunities?: boolean }, actor: Actor = {}) {
  const name = normalize(input.name);
  if (!name || name.length > 50) throw new AppError("nome_invalido", "o nome da etiqueta deve ter de 1 a 50 caracteres", 400);
  try {
    const appliesToContacts = input.appliesToContacts !== false;
    const appliesToOpportunities = input.appliesToOpportunities !== false;
    if (!appliesToContacts && !appliesToOpportunities) throw new AppError("escopo_invalido", "escolha ao menos onde esta tag pode ser usada", 400);
    const tag = await prismaRaw.tag.create({ data: { organizationId, name, color: input.color, description: input.description?.trim().slice(0, 180) ?? "", appliesToContacts, appliesToOpportunities } });
    await writeAudit(prismaRaw, organizationId, { action: "tag.created", entity: "Tag", entityId: tag.id, ...actor, meta: { name } });
    return tag;
  } catch (err) {
    if (isUniqueViolation(err)) throw new AppError("etiqueta_existe", `já existe uma etiqueta "${name}"`);
    throw err;
  }
}

/** Troca (ou remove, com newName=null) um nome de etiqueta em todos os contatos e negócios, inclusive os da lixeira. */
async function rewriteTagOnRecords(
  tx: Parameters<Parameters<typeof prismaRaw.$transaction>[0]>[0],
  organizationId: string,
  oldName: string,
  newName: string | null
) {
  const token = JSON.stringify(oldName);
  const rewrite = (tags: string[]) => {
    const out: string[] = [];
    for (const t of tags) {
      const next = t === oldName ? newName : t;
      if (next && !out.includes(next)) out.push(next);
    }
    return JSON.stringify(out);
  };

  for (let guard = 0; guard < 400; guard++) {
    const contacts = await tx.contact.findMany({
      where: { organizationId, tags: { contains: token } },
      select: { id: true, tags: true },
      take: 500,
    });
    if (contacts.length === 0) break;
    for (const c of contacts) await tx.contact.update({ where: { id: c.id }, data: { tags: rewrite(parseTags(c.tags)) } });
  }
  for (let guard = 0; guard < 400; guard++) {
    const opps = await tx.opportunity.findMany({
      where: { organizationId, tags: { contains: token } },
      select: { id: true, tags: true },
      take: 500,
    });
    if (opps.length === 0) break;
    for (const o of opps) await tx.opportunity.update({ where: { id: o.id }, data: { tags: rewrite(parseTags(o.tags)) } });
  }
}

export async function updateTag(
  organizationId: string,
  id: string,
  input: { name?: string; color?: string; description?: string; appliesToContacts?: boolean; appliesToOpportunities?: boolean },
  actor: Actor = {}
) {
  const tag = await prismaRaw.tag.findFirst({ where: { id, organizationId } });
  if (!tag) throw new AppError("etiqueta_nao_encontrada", "etiqueta não encontrada", 404);

  const name = input.name === undefined ? tag.name : normalize(input.name);
  if (!name || name.length > 50) throw new AppError("nome_invalido", "o nome da etiqueta deve ter de 1 a 50 caracteres", 400);

  const appliesToContacts = input.appliesToContacts ?? tag.appliesToContacts;
  const appliesToOpportunities = input.appliesToOpportunities ?? tag.appliesToOpportunities;
  if (!appliesToContacts && !appliesToOpportunities) throw new AppError("escopo_invalido", "escolha ao menos onde esta tag pode ser usada", 400);
  if ((tag.appliesToContacts && !appliesToContacts) || (tag.appliesToOpportunities && !appliesToOpportunities)) {
    const [contacts, opportunities] = await Promise.all([
      tag.appliesToContacts && !appliesToContacts ? prismaRaw.contact.count({ where: { organizationId, tags: { contains: tag.name } } }) : 0,
      tag.appliesToOpportunities && !appliesToOpportunities ? prismaRaw.opportunity.count({ where: { organizationId, tags: { contains: tag.name } } }) : 0,
    ]);
    if (contacts || opportunities) throw new AppError("escopo_em_uso", "remova esta tag dos registros existentes antes de restringir seu escopo", 409);
  }
  try {
    return await prismaRaw.$transaction(async (tx) => {
      const updated = await tx.tag.update({ where: { id }, data: { name, color: input.color, description: input.description?.trim().slice(0, 180), appliesToContacts, appliesToOpportunities } });
      if (name !== tag.name) {
        await rewriteTagOnRecords(tx, organizationId, tag.name, name);
        await writeAudit(tx, organizationId, {
          action: "tag.renamed",
          entity: "Tag",
          entityId: id,
          ...actor,
          meta: { from: tag.name, to: name },
        });
      }
      return updated;
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw new AppError("etiqueta_existe", `já existe uma etiqueta "${name}"`);
    throw err;
  }
}

export async function deleteTag(organizationId: string, id: string, actor: Actor = {}) {
  const tag = await prismaRaw.tag.findFirst({ where: { id, organizationId } });
  if (!tag) throw new AppError("etiqueta_nao_encontrada", "etiqueta não encontrada", 404);
  await prismaRaw.$transaction(async (tx) => {
    await rewriteTagOnRecords(tx, organizationId, tag.name, null);
    await tx.tag.delete({ where: { id } });
    await writeAudit(tx, organizationId, { action: "tag.deleted", entity: "Tag", entityId: id, ...actor, meta: { name: tag.name } });
  });
  return { ok: true };
}

// ── Motivos de perda ────────────────────────────────────────────────────────

export const listLossReasons = (organizationId: string, includeInactive = false) =>
  prisma.lossReason.findMany({
    where: { organizationId, ...(includeInactive ? {} : { active: true }) },
    orderBy: { name: "asc" },
  });

export async function createLossReason(organizationId: string, input: { name: string }, actor: Actor = {}) {
  const name = normalize(input.name);
  if (!name || name.length > 80) throw new AppError("nome_invalido", "o motivo deve ter de 1 a 80 caracteres", 400);
  try {
    const reason = await prisma.lossReason.create({ data: { organizationId, name } });
    await writeAudit(prisma, organizationId, { action: "loss_reason.created", entity: "LossReason", entityId: reason.id, ...actor });
    return reason;
  } catch (err) {
    if (isUniqueViolation(err)) throw new AppError("motivo_existe", `já existe o motivo "${name}"`);
    throw err;
  }
}

export async function updateLossReason(
  organizationId: string,
  id: string,
  input: { name?: string; active?: boolean }
) {
  const existing = await prisma.lossReason.findFirst({ where: { id, organizationId } });
  if (!existing) throw new AppError("motivo_nao_encontrado", "motivo não encontrado", 404);
  const name = input.name === undefined ? undefined : normalize(input.name);
  if (name !== undefined && (!name || name.length > 80)) {
    throw new AppError("nome_invalido", "o motivo deve ter de 1 a 80 caracteres", 400);
  }
  try {
    return await prisma.$transaction(async (tx) => {
      const updated = await tx.lossReason.update({ where: { id }, data: { name, active: input.active } });
      // Mantém o texto denormalizado dos negócios já perdidos em dia com o nome.
      if (name && name !== existing.name) {
        await tx.opportunity.updateMany({ where: { organizationId, lossReasonId: id }, data: { lossReason: name } });
      }
      return updated;
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw new AppError("motivo_existe", `já existe o motivo "${name}"`);
    throw err;
  }
}

/** Apaga o motivo; se já foi usado, só desativa (para não perder o histórico dos relatórios). */
export async function deleteLossReason(organizationId: string, id: string) {
  const existing = await prisma.lossReason.findFirst({ where: { id, organizationId } });
  if (!existing) throw new AppError("motivo_nao_encontrado", "motivo não encontrado", 404);
  const used = await prismaRaw.opportunity.count({ where: { organizationId, lossReasonId: id } });
  if (used > 0) {
    await prisma.lossReason.update({ where: { id }, data: { active: false } });
    return { ok: true, deactivated: true as const, usedBy: used };
  }
  await prisma.lossReason.delete({ where: { id } });
  return { ok: true, deactivated: false as const, usedBy: 0 };
}

/** Marca o negócio como perdido com um motivo do catálogo. */
export async function setOpportunityLossReason(organizationId: string, opportunityId: string, lossReasonId: string | null) {
  const opp = await prisma.opportunity.findFirst({ where: { id: opportunityId, organizationId } });
  if (!opp) throw new AppError("negocio_nao_encontrado", "negócio não encontrado nesta organização", 404);
  if (!lossReasonId) {
    await prisma.opportunity.update({ where: { id: opportunityId }, data: { lossReasonId: null, lossReason: null } });
    return { ok: true };
  }
  const reason = await prisma.lossReason.findFirst({ where: { id: lossReasonId, organizationId, active: true } });
  if (!reason) throw new AppError("motivo_nao_encontrado", "motivo não encontrado ou inativo", 404);
  await prisma.opportunity.update({ where: { id: opportunityId }, data: { lossReasonId, lossReason: reason.name } });
  return { ok: true };
}

/** Perdas por motivo (para o relatório). */
export async function lossReasonReport(organizationId: string) {
  const grouped = await prisma.opportunity.groupBy({
    by: ["lossReasonId"],
    where: { organizationId, lossReasonId: { not: null } },
    _count: { _all: true },
    _sum: { value: true },
  });
  const reasons = await prisma.lossReason.findMany({ where: { organizationId } });
  const nameById = new Map(reasons.map((r) => [r.id, r.name]));
  return grouped
    .map((g) => ({
      lossReasonId: g.lossReasonId!,
      name: nameById.get(g.lossReasonId!) ?? "(removido)",
      count: g._count._all,
      totalValue: g._sum.value ?? 0,
    }))
    .sort((a, b) => b.count - a.count);
}

// ── Itens do negócio (produtos / procedimentos / pacotes) ───────────────────

export type ItemInput = {
  procedureId?: string;
  name?: string;
  quantity?: number;
  unitCents?: number;
  discountCents?: number;
};

const lineTotal = (i: { quantity: number; unitCents: number; discountCents: number }) =>
  Math.max(0, i.quantity * i.unitCents - i.discountCents);

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

async function recomputeValue(tx: Tx, organizationId: string, opportunityId: string) {
  const items = await tx.opportunityItem.findMany({ where: { opportunityId, organizationId } });
  const cents = items.reduce((sum, i) => sum + lineTotal(i), 0);
  // Sem itens, preserva o valor digitado à mão (negócios antigos).
  if (items.length > 0) {
    await tx.opportunity.update({ where: { id: opportunityId }, data: { value: cents / 100 } });
  }
  return { totalCents: cents, items };
}

export async function listItems(organizationId: string, opportunityId: string) {
  const opp = await prisma.opportunity.findFirst({ where: { id: opportunityId, organizationId } });
  if (!opp) throw new AppError("negocio_nao_encontrado", "negócio não encontrado nesta organização", 404);
  const items = await prisma.opportunityItem.findMany({ where: { opportunityId, organizationId }, orderBy: { id: "asc" } });
  return { items, totalCents: items.reduce((s, i) => s + lineTotal(i), 0) };
}

function validateNumbers(i: { quantity: number; unitCents: number; discountCents: number }) {
  if (!Number.isInteger(i.quantity) || i.quantity < 1 || i.quantity > 10_000) {
    throw new AppError("quantidade_invalida", "quantity deve ser inteiro entre 1 e 10000", 400);
  }
  if (!Number.isInteger(i.unitCents) || i.unitCents < 0) throw new AppError("valor_invalido", "unitCents inválido", 400);
  if (!Number.isInteger(i.discountCents) || i.discountCents < 0) throw new AppError("desconto_invalido", "discountCents inválido", 400);
  if (i.discountCents > i.quantity * i.unitCents) {
    throw new AppError("desconto_invalido", "o desconto não pode ser maior que o total do item", 400);
  }
}

export async function addItem(organizationId: string, opportunityId: string, input: ItemInput, actor: Actor = {}) {
  return prisma.$transaction(async (tx) => {
    const opp = await tx.opportunity.findFirst({ where: { id: opportunityId, organizationId } });
    if (!opp) throw new AppError("negocio_nao_encontrado", "negócio não encontrado nesta organização", 404);

    let name = input.name?.trim();
    let unitCents = input.unitCents;
    if (input.procedureId) {
      const proc = await tx.procedure.findFirst({ where: { id: input.procedureId, organizationId } });
      if (!proc) throw new AppError("procedimento_invalido", "procedimento não encontrado", 404);
      name = name || proc.name;
      unitCents = unitCents ?? proc.priceCents;
    }
    if (!name) throw new AppError("nome_invalido", "informe name ou procedureId", 400);

    const item = { quantity: input.quantity ?? 1, unitCents: unitCents ?? 0, discountCents: input.discountCents ?? 0 };
    validateNumbers(item);

    const created = await tx.opportunityItem.create({
      data: { organizationId, opportunityId, procedureId: input.procedureId ?? null, name, ...item },
    });
    const total = await recomputeValue(tx, organizationId, opportunityId);
    await writeAudit(tx, organizationId, {
      action: "opportunity.item_added",
      entity: "Opportunity",
      entityId: opportunityId,
      ...actor,
      meta: { itemId: created.id, name, totalCents: total.totalCents },
    });
    return { item: created, totalCents: total.totalCents };
  });
}

export async function updateItem(
  organizationId: string,
  opportunityId: string,
  itemId: string,
  input: { name?: string; quantity?: number; unitCents?: number; discountCents?: number },
  actor: Actor = {}
) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.opportunityItem.findFirst({ where: { id: itemId, opportunityId, organizationId } });
    if (!existing) throw new AppError("item_nao_encontrado", "item não encontrado neste negócio", 404);
    const next = {
      quantity: input.quantity ?? existing.quantity,
      unitCents: input.unitCents ?? existing.unitCents,
      discountCents: input.discountCents ?? existing.discountCents,
    };
    validateNumbers(next);
    const updated = await tx.opportunityItem.update({
      where: { id: itemId },
      data: { ...next, name: input.name?.trim() || undefined },
    });
    const total = await recomputeValue(tx, organizationId, opportunityId);
    await writeAudit(tx, organizationId, {
      action: "opportunity.item_updated",
      entity: "Opportunity",
      entityId: opportunityId,
      ...actor,
      meta: { itemId, totalCents: total.totalCents },
    });
    return { item: updated, totalCents: total.totalCents };
  });
}

export async function removeItem(organizationId: string, opportunityId: string, itemId: string, actor: Actor = {}) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.opportunityItem.findFirst({ where: { id: itemId, opportunityId, organizationId } });
    if (!existing) throw new AppError("item_nao_encontrado", "item não encontrado neste negócio", 404);
    await tx.opportunityItem.delete({ where: { id: itemId } });
    const total = await recomputeValue(tx, organizationId, opportunityId);
    await writeAudit(tx, organizationId, {
      action: "opportunity.item_removed",
      entity: "Opportunity",
      entityId: opportunityId,
      ...actor,
      meta: { itemId, totalCents: total.totalCents },
    });
    return { ok: true, totalCents: total.totalCents };
  });
}
