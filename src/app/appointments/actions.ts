"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireOrgUser } from "@/lib/auth";
import { createCalendarEvent, updateCalendarEvent, deleteCalendarEvent } from "@/lib/providers/google-calendar";
import { actorOf, audit } from "@/lib/audit";
import { softDeleteAppointment } from "@/lib/soft-delete";
import { triggerAppointmentAutomations } from "@/lib/automation/engine";
import { hasModulePermission } from "@/lib/access";

async function requireAgendaWrite() {
  const user = await requireOrgUser();
  if (!hasModulePermission(user, "agenda.write")) throw new Error("Sem permissão para alterar agendamentos.");
  return user;
}

function appointmentContext(appointment: { id: string; contactId: string | null; ownerId: string | null; professionalId?: string | null; procedureId?: string | null; bookingChannel?: string | null; startAt: Date; status: string }) {
  return { id: appointment.id, contactId: appointment.contactId, ownerId: appointment.ownerId, professionalId: appointment.professionalId ?? null, procedureId: appointment.procedureId ?? null, bookingChannel: appointment.bookingChannel ?? null, startAt: appointment.startAt, status: appointment.status };
}

async function fireAppointmentAutomation(organizationId: string, trigger: Parameters<typeof triggerAppointmentAutomations>[1], appointment: Parameters<typeof triggerAppointmentAutomations>[2]) {
  await triggerAppointmentAutomations(organizationId, trigger, appointment).catch((error) => {
    console.error("[automations] falha ao disparar evento de agenda:", error);
  });
}

export type AppointmentInput = {
  title: string;
  notes: string;
  startAt: string;
  endAt: string;
  contactId: string | null;
  ownerId: string | null;
};

export async function createAppointment(data: AppointmentInput) {
  const { organizationId } = await requireAgendaWrite();

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

  const appointment = await prisma.appointment.create({
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
  await fireAppointmentAutomation(organizationId, "APPOINTMENT_CREATED", appointmentContext(appointment));
  revalidatePath("/appointments");
}

export async function updateAppointment(id: string, data: AppointmentInput) {
  const { organizationId } = await requireAgendaWrite();
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

  const updated = await prisma.appointment.update({
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
  if (existing.startAt.getTime() !== updated.startAt.getTime() || existing.endAt.getTime() !== updated.endAt.getTime()) {
    await fireAppointmentAutomation(organizationId, "APPOINTMENT_RESCHEDULED", appointmentContext(updated));
  }
  revalidatePath("/appointments");
}

export async function setAppointmentStatus(id: string, status: "SCHEDULED" | "CONFIRMED" | "CANCELLED" | "COMPLETED" | "NO_SHOW") {
  const { organizationId } = await requireAgendaWrite();
  const existing = await prisma.appointment.findFirst({ where: { id, organizationId } });
  if (!existing || existing.status === status) return;
  const appointment = await prisma.appointment.update({ where: { id }, data: { status } });
  const events: Partial<Record<typeof status, "APPOINTMENT_CONFIRMED" | "APPOINTMENT_CANCELLED" | "APPOINTMENT_NO_SHOW">> = {
    CONFIRMED: "APPOINTMENT_CONFIRMED", CANCELLED: "APPOINTMENT_CANCELLED", NO_SHOW: "APPOINTMENT_NO_SHOW",
  };
  const trigger = events[status];
  if (trigger) await fireAppointmentAutomation(organizationId, trigger, appointmentContext(appointment));
  revalidatePath("/appointments");
}

export async function deleteAppointment(id: string) {
  const user = await requireAgendaWrite();
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
  const user = await requireAgendaWrite();
  if (user.role !== "ADMIN") throw new Error("Somente administradores podem desconectar calendários.");
  const { organizationId } = user;
  const target = await prisma.user.findFirst({ where: { id: userId, organizationId } });
  if (!target) return;
  await prisma.googleAccount.delete({ where: { userId } }).catch(() => {});
  revalidatePath("/appointments");
}
