import "server-only";
import type { DbClient } from "./prisma";

// Manda registros para a lixeira (deletedAt). Funciona com o cliente normal
// ou dentro de uma transação — por isso recebe `db`. Contato leva junto as
// oportunidades e agendamentos dele, todos com o MESMO carimbo de data, que é
// o que permite restaurar o conjunto de uma vez (lib/trash.ts).

export async function softDeleteContacts(db: DbClient, organizationId: string, ids: string[], now = new Date()) {
  if (ids.length === 0) return { count: 0 };
  const res = await db.contact.updateMany({ where: { id: { in: ids }, organizationId }, data: { deletedAt: now } });
  if (res.count > 0) {
    await db.opportunity.updateMany({ where: { contactId: { in: ids }, organizationId }, data: { deletedAt: now } });
    await db.appointment.updateMany({ where: { contactId: { in: ids }, organizationId }, data: { deletedAt: now } });
  }
  return { count: res.count };
}

export async function softDeleteOpportunity(db: DbClient, organizationId: string, id: string, now = new Date()) {
  return db.opportunity.updateMany({ where: { id, organizationId }, data: { deletedAt: now } });
}

export async function softDeleteAppointment(db: DbClient, organizationId: string, id: string, now = new Date()) {
  return db.appointment.updateMany({ where: { id, organizationId }, data: { deletedAt: now } });
}
