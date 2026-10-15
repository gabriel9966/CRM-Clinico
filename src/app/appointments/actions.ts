"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireOrgUser } from "@/lib/auth";
import { createCalendarEvent, updateCalendarEvent, deleteCalendarEvent } from "@/lib/providers/google-calendar";
import { actorOf, audit } from "@/lib/audit";
import { softDeleteAppointment } from "@/lib/soft-delete";

export type AppointmentInput = {
  title: string;
  notes: string;
  startAt: string;
  endAt: string;
  contactId: string | null;
  ownerId: string | null;
};

export async function createAppointment(data: AppointmentInput) {
  const { organizationId } = await requireOrgUser();

  const contact = data.contactId ? await prisma.contact.findFirst({ where: { id: data.contactId, organizationId } }) : null;
  const owner = data.ownerId ? await prisma.user.findFirst({ where: { id: data.ownerId, organizationId } }) : null;
  const startAt = new Date(data.startAt);
  const endAt = new Date(data.endAt);

  let googleEventId: string | null = null;
  if (owner) {
    try {
      googleEventId = await createCalendarEvent(owner.id, {
        title: data.title,
        notes: data.notes,
        startAt,
        endAt,
        attendeeEmail: contact?.email,
      });
    } catch {
      googleEventId = null;
    }
  }

  await prisma.appointment.create({
    data: {
      organizationId,
      title: data.title,
      notes: data.notes || null,
      startAt,
      endAt,
      contactId: contact?.id ?? null,
      ownerId: owner?.id ?? null,
      googleEventId,
    },
  });
  revalidatePath("/appointments");
}

export async function updateAppointment(id: string, data: AppointmentInput) {
  const { organizationId } = await requireOrgUser();
  const existing = await prisma.appointment.findFirst({ where: { id, organizationId } });
  if (!existing) return;

  const contact = data.contactId ? await prisma.contact.findFirst({ where: { id: data.contactId, organizationId } }) : null;
  const owner = data.ownerId ? await prisma.user.findFirst({ where: { id: data.ownerId, organizationId } }) : null;
  const startAt = new Date(data.startAt);
  const endAt = new Date(data.endAt);

  let googleEventId = existing.googleEventId ?? null;
  if (owner) {
    try {
      if (googleEventId && existing.ownerId === owner.id) {
        await updateCalendarEvent(owner.id, googleEventId, { title: data.title, notes: data.notes, startAt, endAt });
      } else {
        googleEventId = await createCalendarEvent(owner.id, {
          title: data.title,
          notes: data.notes,
          startAt,
          endAt,
          attendeeEmail: contact?.email,
        });
      }
    } catch {
      // mantém o agendamento salvo no CRM mesmo se a sincronização falhar
    }
  }

  await prisma.appointment.update({
    where: { id },
    data: {
      title: data.title,
      notes: data.notes || null,
      startAt,
      endAt,
      contactId: contact?.id ?? null,
      ownerId: owner?.id ?? null,
      googleEventId,
    },
  });
  revalidatePath("/appointments");
}

export async function setAppointmentStatus(id: string, status: "SCHEDULED" | "CONFIRMED" | "CANCELLED" | "COMPLETED" | "NO_SHOW") {
  const { organizationId } = await requireOrgUser();
  await prisma.appointment.updateMany({ where: { id, organizationId }, data: { status } });
  revalidatePath("/appointments");
}

export async function deleteAppointment(id: string) {
  const user = await requireOrgUser();
  const { organizationId } = user;
  const appt = await prisma.appointment.findFirst({ where: { id, organizationId } });
  if (!appt) return;
  if (appt.googleEventId && appt.ownerId) {
    await deleteCalendarEvent(appt.ownerId, appt.googleEventId).catch(() => {});
  }
  await softDeleteAppointment(prisma, organizationId, id);
  await audit(organizationId, { action: "appointment.deleted", entity: "Appointment", entityId: id, ...actorOf(user) });
  revalidatePath("/appointments");
  revalidatePath("/trash");
}

export async function disconnectGoogle(userId: string) {
  const { organizationId } = await requireOrgUser();
  const target = await prisma.user.findFirst({ where: { id: userId, organizationId } });
  if (!target) return;
  await prisma.googleAccount.delete({ where: { userId } }).catch(() => {});
  revalidatePath("/appointments");
}
