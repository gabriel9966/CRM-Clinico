import "server-only";
import { prismaRaw as db } from "./prisma";
import { writeAudit, type AuditEntry } from "./audit";
import { AppError } from "./errors";
import type { TrashEntity, TrashItemDTO } from "./types";

// Lixeira: lista, restaura e apaga de vez o que foi removido (deletedAt).
// Usa o cliente SEM filtro (prismaRaw) — o `prisma` normal nunca enxerga
// registros apagados. Tudo filtrado por organizationId.

export type { TrashEntity, TrashItemDTO };

export class TrashError extends AppError {}

const PAGE = 100;

export async function listTrash(organizationId: string): Promise<TrashItemDTO[]> {
  const deleted = { not: null } as const;
  const [contacts, opps, appts] = await Promise.all([
    db.contact.findMany({
      where: { organizationId, deletedAt: deleted },
      orderBy: { deletedAt: "desc" },
      take: PAGE,
      select: { id: true, name: true, phone: true, email: true, deletedAt: true },
    }),
    db.opportunity.findMany({
      where: { organizationId, deletedAt: deleted },
      orderBy: { deletedAt: "desc" },
      take: PAGE,
      select: { id: true, title: true, value: true, deletedAt: true, contact: { select: { name: true } } },
    }),
    db.appointment.findMany({
      where: { organizationId, deletedAt: deleted },
      orderBy: { deletedAt: "desc" },
      take: PAGE,
      select: { id: true, title: true, startAt: true, deletedAt: true },
    }),
  ]);

  const items: TrashItemDTO[] = [
    ...contacts.map((c) => ({
      entity: "contact" as const,
      id: c.id,
      title: c.name,
      detail: c.phone ?? c.email ?? null,
      deletedAt: c.deletedAt!.toISOString(),
    })),
    ...opps.map((o) => ({
      entity: "opportunity" as const,
      id: o.id,
      title: o.title,
      detail: o.contact?.name ?? null,
      deletedAt: o.deletedAt!.toISOString(),
    })),
    ...appts.map((a) => ({
      entity: "appointment" as const,
      id: a.id,
      title: a.title,
      detail: a.startAt.toISOString(),
      deletedAt: a.deletedAt!.toISOString(),
    })),
  ];
  return items.sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));
}

type Actor = Pick<AuditEntry, "actorId" | "actorName">;

export async function restore(organizationId: string, entity: TrashEntity, id: string, actor: Actor = {}) {
  await db.$transaction(async (tx) => {
    if (entity === "contact") {
      const c = await tx.contact.findFirst({ where: { id, organizationId, deletedAt: { not: null } } });
      if (!c) throw new TrashError("nao_encontrado", "item não está na lixeira", 404);
      // Restaura junto o que foi apagado no MESMO instante (o conjunto que
      // veio com o contato); itens apagados separadamente antes continuam lá.
      await tx.contact.update({ where: { id }, data: { deletedAt: null } });
      await tx.opportunity.updateMany({ where: { contactId: id, organizationId, deletedAt: c.deletedAt }, data: { deletedAt: null } });
      await tx.appointment.updateMany({ where: { contactId: id, organizationId, deletedAt: c.deletedAt }, data: { deletedAt: null } });
    } else if (entity === "opportunity") {
      const o = await tx.opportunity.findFirst({ where: { id, organizationId, deletedAt: { not: null } }, include: { contact: true } });
      if (!o) throw new TrashError("nao_encontrado", "item não está na lixeira", 404);
      if (o.contact.deletedAt) throw new TrashError("contato_na_lixeira", "restaure o contato antes de restaurar este negócio");
      await tx.opportunity.update({ where: { id }, data: { deletedAt: null } });
    } else {
      const a = await tx.appointment.findFirst({ where: { id, organizationId, deletedAt: { not: null } }, include: { contact: true } });
      if (!a) throw new TrashError("nao_encontrado", "item não está na lixeira", 404);
      if (a.contact?.deletedAt) throw new TrashError("contato_na_lixeira", "restaure o contato antes de restaurar este agendamento");
      await tx.appointment.update({ where: { id }, data: { deletedAt: null } });
    }
    await writeAudit(tx, organizationId, { action: `${entity}.restored`, entity: capitalize(entity), entityId: id, ...actor });
  });
}

/** Apaga de vez. Só aceita itens que já estão na lixeira. */
export async function purge(organizationId: string, entity: TrashEntity, id: string, actor: Actor = {}) {
  await db.$transaction(async (tx) => {
    const where = { id, organizationId, deletedAt: { not: null } };
    const res =
      entity === "contact"
        ? await tx.contact.deleteMany({ where })
        : entity === "opportunity"
          ? await tx.opportunity.deleteMany({ where })
          : await tx.appointment.deleteMany({ where });
    if (res.count === 0) throw new TrashError("nao_encontrado", "item não está na lixeira", 404);
    await writeAudit(tx, organizationId, { action: `${entity}.purged`, entity: capitalize(entity), entityId: id, ...actor });
  });
}

/** Esvazia tudo que está na lixeira há mais de `days` dias (retenção). */
export async function purgeOlderThan(organizationId: string, days: number, actor: Actor = {}) {
  const cutoff = new Date(Date.now() - days * 86_400_000);
  return db.$transaction(async (tx) => {
    const where = { organizationId, deletedAt: { not: null, lt: cutoff } };
    const a = await tx.appointment.deleteMany({ where });
    const o = await tx.opportunity.deleteMany({ where });
    const c = await tx.contact.deleteMany({ where });
    const total = a.count + o.count + c.count;
    if (total > 0) {
      await writeAudit(tx, organizationId, {
        action: "trash.emptied",
        entity: "Trash",
        ...actor,
        meta: { days, contacts: c.count, opportunities: o.count, appointments: a.count },
      });
    }
    return { contacts: c.count, opportunities: o.count, appointments: a.count };
  });
}

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
