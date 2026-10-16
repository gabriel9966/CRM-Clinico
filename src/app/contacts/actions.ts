"use server";

import { revalidatePath } from "next/cache";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireOrgUser } from "@/lib/auth";
import { triggerAutomations } from "@/lib/automation/engine";
import { parseCsv } from "@/lib/csv";
import { actorOf, audit } from "@/lib/audit";
import { syncTags } from "@/lib/crm-catalog";
import { softDeleteContacts } from "@/lib/soft-delete";

export type ContactInput = {
  name: string;
  company: string;
  email: string;
  phone: string;
  tags: string[];
  notes: string;
  ownerId: string | null;
  customFields?: Record<string, unknown>;
};

function parseTags(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function createContact(data: ContactInput) {
  const { organizationId } = await requireOrgUser();
  const contact = await prisma.contact.create({
    data: {
      organizationId,
      name: data.name,
      company: data.company || null,
      email: data.email || null,
      phone: data.phone || null,
      tags: JSON.stringify(data.tags),
      notes: data.notes || null,
      ownerId: data.ownerId,
      customFields: (data.customFields ?? {}) as Prisma.InputJsonValue,
    },
  });
  await syncTags(organizationId, data.tags);
  revalidatePath("/contacts");
  revalidatePath("/pipeline");
  await triggerAutomations(organizationId, "CONTACT_CREATED", { contactId: contact.id });
  for (const tag of data.tags) {
    await triggerAutomations(organizationId, "TAG_ADDED", { contactId: contact.id, tag });
  }
}

export async function updateContact(id: string, data: ContactInput) {
  const { organizationId } = await requireOrgUser();
  const before = await prisma.contact.findFirst({ where: { id, organizationId } });
  if (!before) return;
  const beforeTags = parseTags(before.tags);

  await prisma.contact.update({
    where: { id },
    data: {
      name: data.name,
      company: data.company || null,
      email: data.email || null,
      phone: data.phone || null,
      tags: JSON.stringify(data.tags),
      notes: data.notes || null,
      ownerId: data.ownerId,
      customFields: (data.customFields ?? {}) as Prisma.InputJsonValue,
    },
  });
  await syncTags(organizationId, data.tags);
  revalidatePath("/contacts");
  revalidatePath("/pipeline");
  revalidatePath("/conversations");

  const newTags = data.tags.filter((t) => !beforeTags.includes(t));
  for (const tag of newTags) {
    await triggerAutomations(organizationId, "TAG_ADDED", { contactId: id, tag });
  }
}

// Reatribuição manual do dono de um contato (ex: a partir da caixa de
// conversas) — só ADMIN pode usar; checado aqui no server, não só escondendo
// o botão na UI, já que uma server action pode ser chamada direto.
export async function reassignContactOwner(contactId: string, ownerId: string | null) {
  const user = await requireOrgUser();
  if (user.role !== "ADMIN") return;
  await prisma.contact.updateMany({ where: { id: contactId, organizationId: user.organizationId }, data: { ownerId } });
  revalidatePath("/conversations");
  revalidatePath("/contacts");
}

export async function deleteContact(id: string) {
  const user = await requireOrgUser();
  const { organizationId } = user;
  const res = await softDeleteContacts(prisma, organizationId, [id]);
  if (res.count > 0) {
    await audit(organizationId, { action: "contact.deleted", entity: "Contact", entityId: id, ...actorOf(user) });
  }
  revalidatePath("/contacts");
  revalidatePath("/trash");
  revalidatePath("/pipeline");
  revalidatePath("/conversations");
}

/** Ações em lote da tabela de leads; ids são sempre restringidos ao tenant atual. */
export async function bulkUpdateContacts(ids: string[], input: { ownerId?: string | null; addTags?: string[]; removeTags?: string[]; delete?: boolean }) {
  const user = await requireOrgUser();
  const contactIds = [...new Set(ids)].slice(0, 500);
  if (!contactIds.length) return;
  if (input.delete) {
    await softDeleteContacts(prisma, user.organizationId, contactIds);
  } else {
    const contacts = await prisma.contact.findMany({ where: { id: { in: contactIds }, organizationId: user.organizationId }, select: { id: true, tags: true } });
    if (input.ownerId !== undefined) await prisma.contact.updateMany({ where: { id: { in: contacts.map((c) => c.id) }, organizationId: user.organizationId }, data: { ownerId: input.ownerId } });
    if (input.addTags?.length || input.removeTags?.length) {
      for (const contact of contacts) {
        const tags = new Set(parseTags(contact.tags));
        for (const tag of input.addTags ?? []) tags.add(tag);
        for (const tag of input.removeTags ?? []) tags.delete(tag);
        await prisma.contact.update({ where: { id: contact.id }, data: { tags: JSON.stringify([...tags]) } });
      }
      await syncTags(user.organizationId, input.addTags ?? []);
    }
  }
  revalidatePath("/contacts"); revalidatePath("/pipeline"); revalidatePath("/conversations");
}

// Mescla um ou mais contatos (mergeIds) dentro do contato sobrevivente
// (keepId): repõe mensagens/atividades/agendamentos/oportunidades para o
// sobrevivente, une tags/notas, preenche campos vazios do sobrevivente com
// valores dos descartados, e apaga os descartados. Canais externos
// (ContactChannel) que colidiriam com o unique [connectionId, externalId] do
// sobrevivente são descartados em vez de reapontados.
export async function mergeContacts(keepId: string, mergeIds: string[]) {
  const user = await requireOrgUser();
  const { organizationId } = user;
  const loserIds = [...new Set(mergeIds)].filter((id) => id !== keepId);
  if (loserIds.length === 0) return;

  const [keep, losers] = await Promise.all([
    prisma.contact.findFirst({ where: { id: keepId, organizationId } }),
    prisma.contact.findMany({ where: { id: { in: loserIds }, organizationId } }),
  ]);
  if (!keep || losers.length === 0) return;

  const mergedTags = new Set(parseTags(keep.tags));
  const mergedNotes: string[] = keep.notes ? [keep.notes] : [];
  let company = keep.company;
  let email = keep.email;
  let phone = keep.phone;
  let customFields: Record<string, unknown> = { ...(keep.customFields as Record<string, unknown>) };

  for (const loser of losers) {
    for (const t of parseTags(loser.tags)) mergedTags.add(t);
    if (loser.notes) mergedNotes.push(loser.notes);
    company = company || loser.company;
    email = email || loser.email;
    phone = phone || loser.phone;
    customFields = { ...(loser.customFields as Record<string, unknown>), ...customFields };
  }

  await prisma.$transaction(async (tx) => {
    for (const loser of losers) {
      const channels = await tx.contactChannel.findMany({ where: { contactId: loser.id } });
      for (const ch of channels) {
        const clash = await tx.contactChannel.findFirst({
          where: { contactId: keepId, connectionId: ch.connectionId, externalId: ch.externalId },
        });
        if (clash) {
          await tx.contactChannel.delete({ where: { id: ch.id } });
        } else {
          await tx.contactChannel.update({ where: { id: ch.id }, data: { contactId: keepId } });
        }
      }
      await tx.message.updateMany({ where: { contactId: loser.id }, data: { contactId: keepId } });
      await tx.activity.updateMany({ where: { contactId: loser.id }, data: { contactId: keepId } });
      await tx.appointment.updateMany({ where: { contactId: loser.id }, data: { contactId: keepId } });
      await tx.opportunity.updateMany({ where: { contactId: loser.id }, data: { contactId: keepId } });
    }

    await tx.contact.update({
      where: { id: keepId },
      data: {
        company,
        email,
        phone,
        tags: JSON.stringify([...mergedTags]),
        notes: mergedNotes.join("\n\n") || null,
        customFields: customFields as Prisma.InputJsonValue,
      },
    });
    await softDeleteContacts(tx, organizationId, loserIds);
  });
  await audit(organizationId, {
    action: "contact.merged",
    entity: "Contact",
    entityId: keepId,
    ...actorOf(user),
    meta: { mergedIds: loserIds },
  });

  revalidatePath("/contacts");
  revalidatePath("/pipeline");
  revalidatePath("/conversations");
}

export type ImportSummary = { created: number; skipped: number; errors: string[] };

// Importa contatos de um CSV com colunas: name, company, email, phone, tags
// (separadas por ;), notes, owner (nome do atendente, opcional). Linhas sem
// "name" são puladas. "owner" é resolvido por nome dentro da própria
// organização — nunca cria nem reatribui pra fora dela.
export async function importContactsCsv(csvText: string): Promise<ImportSummary> {
  const { organizationId } = await requireOrgUser();
  const rows = parseCsv(csvText);
  const team = await prisma.user.findMany({ where: { organizationId }, select: { id: true, name: true } });

  let created = 0;
  let skipped = 0;
  const errors: string[] = [];
  const importedTags = new Set<string>();

  for (const [i, row] of rows.entries()) {
    const name = (row.name || "").trim();
    if (!name) {
      skipped++;
      errors.push(`Linha ${i + 2}: sem nome, pulada.`);
      continue;
    }
    const owner = row.owner ? team.find((m) => m.name.toLowerCase() === row.owner.toLowerCase()) : undefined;
    const tags = (row.tags || "").split(";").map((t) => t.trim()).filter(Boolean);
    tags.forEach((t) => importedTags.add(t));

    await prisma.contact.create({
      data: {
        organizationId,
        name,
        company: row.company || null,
        email: row.email || null,
        phone: row.phone || null,
        tags: JSON.stringify(tags),
        notes: row.notes || null,
        ownerId: owner?.id ?? null,
      },
    });
    created++;
  }

  await syncTags(organizationId, [...importedTags]);
  revalidatePath("/contacts");
  revalidatePath("/pipeline");
  return { created, skipped, errors };
}
