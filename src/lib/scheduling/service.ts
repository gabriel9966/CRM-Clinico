import "server-only";
import { prisma, type DbClient } from "../prisma";
import { writeAudit } from "../audit";
import { AppError } from "../errors";
import { updateCalendarEvent, deleteCalendarEvent } from "../providers/google-calendar";
import {
  computeDaySlots,
  pickLeastLoaded,
  type BlockInput,
  type BusyAppointment,
  type ExceptionInput,
  type ProfessionalInput,
  type Slot,
} from "./availability";
import { addDays, isValidDateStr, toTzIso, tzDateTime, tzParts } from "./time";

type Db = DbClient;

// Agendamentos nestes status ocupam a agenda; cancelados e faltas liberam o horário.
const ACTIVE_STATUSES = ["SCHEDULED", "CONFIRMED", "COMPLETED"] as const;
const MAX_RANGE_DAYS = 31;
const BOOKING_MIN_LEAD_MIN = 1;

export class SchedulingError extends AppError {}

type OrgConfig = { timezone: string; slotStepMin: number; minLeadMinutes: number };

type RangeData = {
  org: OrgConfig;
  professionals: ProfessionalInput[];
  nameById: Map<string, string>;
  blocks: BlockInput[];
  exceptions: ExceptionInput[];
  appointments: (BusyAppointment & { id: string })[];
};

export { writeAudit };

async function loadRange(
  db: Db,
  organizationId: string,
  fromDate: string,
  toDateInclusive: string,
  professionalId?: string
): Promise<RangeData> {
  const org = await db.organization.findUnique({
    where: { id: organizationId },
    select: { timezone: true, slotStepMin: true, minLeadMinutes: true },
  });
  if (!org) throw new SchedulingError("org_not_found", "organização não encontrada", 404);

  const rangeStart = tzDateTime(fromDate, 0, org.timezone);
  const rangeEnd = tzDateTime(addDays(toDateInclusive, 1), 0, org.timezone);

  const [pros, blocks, appts] = await Promise.all([
    db.professional.findMany({
      where: { organizationId, active: true, ...(professionalId ? { id: professionalId } : {}) },
      orderBy: { createdAt: "asc" },
    }),
    db.scheduleBlock.findMany({ where: { organizationId }, include: { exceptions: true } }),
    db.appointment.findMany({
      where: {
        organizationId,
        status: { in: [...ACTIVE_STATUSES] },
        startAt: { lt: rangeEnd },
        endAt: { gt: rangeStart },
      },
      select: { id: true, professionalId: true, roomId: true, startAt: true, endAt: true },
    }),
  ]);

  return {
    org,
    professionals: pros.map((p) => ({
      id: p.id,
      name: p.name,
      workDays: p.workDays,
      workStartMin: p.workStartMin,
      workEndMin: p.workEndMin,
    })),
    nameById: new Map(pros.map((p) => [p.id, p.name])),
    blocks: blocks.map((b) => ({
      id: b.id,
      professionalId: b.professionalId,
      isRecurring: b.isRecurring,
      date: b.date,
      weekday: b.weekday,
      startMin: b.startMin,
      endMin: b.endMin,
    })),
    exceptions: blocks.flatMap((b) =>
      b.exceptions.map((e) => ({ blockId: b.id, date: e.date, startMin: e.startMin, endMin: e.endMin }))
    ),
    appointments: appts,
  };
}

async function resolveDuration(
  db: Db,
  organizationId: string,
  input: { procedureId?: string | null; durationMin?: number | null }
) {
  if (input.procedureId) {
    const proc = await db.procedure.findFirst({ where: { id: input.procedureId, organizationId, active: true } });
    if (!proc) throw new SchedulingError("procedimento_invalido", "procedimento não encontrado", 404);
    return { durationMin: proc.durationMin, procedureName: proc.name as string | null };
  }
  const d = input.durationMin ?? 60;
  if (!Number.isInteger(d) || d < 5 || d > 720) {
    throw new SchedulingError("duracao_invalida", "durationMin deve ser inteiro entre 5 e 720", 400);
  }
  return { durationMin: d, procedureName: null as string | null };
}

// ── Consulta de horários livres ────────────────────────────────────────────

export type AvailabilityQuery = {
  from?: string; // YYYY-MM-DD no fuso da organização (padrão: hoje)
  to?: string; // YYYY-MM-DD inclusive (padrão: from + 6 dias)
  procedureId?: string;
  durationMin?: number;
  professionalId?: string;
  roomId?: string;
  limit?: number;
};

export async function getAvailability(organizationId: string, q: AvailabilityQuery) {
  const now = new Date();
  const orgRow = await prisma.organization.findUnique({ where: { id: organizationId }, select: { timezone: true } });
  if (!orgRow) throw new SchedulingError("org_not_found", "organização não encontrada", 404);

  const from = q.from ?? tzParts(now, orgRow.timezone).dateStr;
  if (!isValidDateStr(from)) throw new SchedulingError("from_invalido", "from deve ser YYYY-MM-DD", 400);
  const to = q.to ?? addDays(from, 6);
  if (!isValidDateStr(to)) throw new SchedulingError("to_invalido", "to deve ser YYYY-MM-DD", 400);
  if (to < from) throw new SchedulingError("periodo_invalido", "to anterior a from", 400);
  if (addDays(from, MAX_RANGE_DAYS) < to) {
    throw new SchedulingError("periodo_longo", `período máximo de ${MAX_RANGE_DAYS} dias`, 400);
  }
  const limit = Math.min(Math.max(q.limit ?? 20, 1), 100);

  const { durationMin } = await resolveDuration(prisma, organizationId, q);
  if (q.roomId) await assertRoom(prisma, organizationId, q.roomId);

  const data = await loadRange(prisma, organizationId, from, to, q.professionalId);
  const slots: { start: string; end: string; professionals: { id: string; name: string }[] }[] = [];

  for (let day = from; day <= to && slots.length < limit; day = addDays(day, 1)) {
    const daySlots = computeDaySlots({
      dateStr: day,
      tz: data.org.timezone,
      stepMin: data.org.slotStepMin,
      durationMin,
      professionals: data.professionals,
      blocks: data.blocks,
      exceptions: data.exceptions,
      appointments: data.appointments,
      roomId: q.roomId,
      now,
      minLeadMin: data.org.minLeadMinutes,
    });
    for (const s of daySlots) {
      if (slots.length >= limit) break;
      slots.push({
        start: toTzIso(s.start, data.org.timezone),
        end: toTzIso(s.end, data.org.timezone),
        professionals: s.professionalIds.map((id) => ({ id, name: data.nameById.get(id) ?? "" })),
      });
    }
  }

  return { timezone: data.org.timezone, durationMin, slots };
}

async function assertRoom(db: Db, organizationId: string, roomId: string) {
  const room = await db.room.findFirst({ where: { id: roomId, organizationId, active: true } });
  if (!room) throw new SchedulingError("sala_invalida", "sala não encontrada", 404);
}

// ── Escolha de horário + profissional (usada por agendar e remarcar) ───────

async function pickSlotAndProfessional(
  db: Db,
  organizationId: string,
  opts: {
    start: Date;
    durationMin: number;
    professionalId?: string | null;
    roomId?: string | null;
    allowReassign: boolean;
    excludeAppointmentId?: string;
  }
) {
  const now = new Date();
  if (Number.isNaN(opts.start.getTime())) throw new SchedulingError("inicio_invalido", "startAt inválido", 400);
  if (opts.start.getTime() < now.getTime() + BOOKING_MIN_LEAD_MIN * 60_000) {
    throw new SchedulingError("horario_no_passado", "horário já passou");
  }

  const orgRow = await db.organization.findUnique({ where: { id: organizationId }, select: { timezone: true } });
  if (!orgRow) throw new SchedulingError("org_not_found", "organização não encontrada", 404);
  const { dateStr, minutesOfDay } = tzParts(opts.start, orgRow.timezone);

  const data = await loadRange(db, organizationId, dateStr, dateStr);
  if (minutesOfDay % data.org.slotStepMin !== 0) {
    throw new SchedulingError("horario_fora_da_grade", `use horários múltiplos de ${data.org.slotStepMin} min`);
  }

  if (opts.professionalId && !data.nameById.has(opts.professionalId)) {
    throw new SchedulingError("profissional_invalido", "profissional não encontrado ou inativo", 404);
  }

  const appointments = opts.excludeAppointmentId
    ? data.appointments.filter((a) => a.id !== opts.excludeAppointmentId)
    : data.appointments;

  const slots: Slot[] = computeDaySlots({
    dateStr,
    tz: data.org.timezone,
    stepMin: data.org.slotStepMin,
    durationMin: opts.durationMin,
    professionals: data.professionals,
    blocks: data.blocks,
    exceptions: data.exceptions,
    appointments,
    roomId: opts.roomId,
    now,
    minLeadMin: 0,
  });
  const slot = slots.find((s) => s.start.getTime() === opts.start.getTime());
  if (!slot) throw new SchedulingError("slot_indisponivel", "horário indisponível");

  // Carga do dia por profissional, para distribuir entre os livres.
  const load = new Map<string, number>();
  for (const a of appointments) {
    if (a.professionalId) load.set(a.professionalId, (load.get(a.professionalId) ?? 0) + 1);
  }

  let professionalId: string;
  let reassigned = false;
  if (opts.professionalId) {
    if (slot.professionalIds.includes(opts.professionalId)) {
      professionalId = opts.professionalId;
    } else if (opts.allowReassign) {
      const alt = pickLeastLoaded(slot.professionalIds, load);
      if (!alt) throw new SchedulingError("slot_indisponivel", "horário indisponível");
      professionalId = alt;
      reassigned = true;
    } else {
      throw new SchedulingError("profissional_ocupado", "o profissional escolhido não está livre nesse horário");
    }
  } else {
    const alt = pickLeastLoaded(slot.professionalIds, load);
    if (!alt) throw new SchedulingError("slot_indisponivel", "horário indisponível");
    professionalId = alt;
  }

  return {
    professionalId,
    professionalName: data.nameById.get(professionalId) ?? "",
    reassigned,
    end: new Date(opts.start.getTime() + opts.durationMin * 60_000),
    timezone: data.org.timezone,
  };
}

// ── Contato ────────────────────────────────────────────────────────────────

function digits(s: string) {
  return s.replace(/\D/g, "");
}

async function resolveContact(
  db: Db,
  organizationId: string,
  input: { contactId?: string; contact?: { name: string; phone?: string; email?: string } },
  create: boolean
) {
  if (input.contactId) {
    const c = await db.contact.findFirst({ where: { id: input.contactId, organizationId } });
    if (!c) throw new SchedulingError("contato_invalido", "contato não encontrado nesta organização", 404);
    return c;
  }
  const info = input.contact;
  if (!info) return null;
  const phoneDigits = info.phone ? digits(info.phone) : "";
  if (phoneDigits.length >= 8) {
    // Compara pelos últimos 9 dígitos para casar "+5511999998888" com "11999998888".
    const found = await db.contact.findFirst({
      where: { organizationId, phone: { contains: phoneDigits.slice(-9) } },
    });
    if (found) return found;
  }
  if (!create) return { id: null as string | null, name: info.name, email: info.email ?? null };
  return db.contact.create({
    data: { organizationId, name: info.name, phone: info.phone, email: info.email },
  });
}

// ── Agendar ────────────────────────────────────────────────────────────────

export type BookInput = {
  startAt: string;
  procedureId?: string;
  durationMin?: number;
  professionalId?: string;
  roomId?: string;
  contactId?: string;
  contact?: { name: string; phone?: string; email?: string };
  title?: string;
  notes?: string;
  idempotencyKey?: string;
  bookingChannel?: string;
  /** Valida tudo e devolve o desfecho sem gravar nada. */
  dryRun?: boolean;
  /** Se o profissional pedido estiver ocupado, usa outro livre (padrão: true). */
  allowReassign?: boolean;
  actorId?: string;
};

function serialize(a: {
  id: string;
  title: string;
  startAt: Date;
  endAt: Date;
  status: string;
  professionalId: string | null;
  roomId: string | null;
  procedureId: string | null;
  contactId: string | null;
}, tz: string) {
  return {
    id: a.id,
    title: a.title,
    start: toTzIso(a.startAt, tz),
    end: toTzIso(a.endAt, tz),
    status: a.status,
    professionalId: a.professionalId,
    roomId: a.roomId,
    procedureId: a.procedureId,
    contactId: a.contactId,
  };
}

export async function bookAppointment(organizationId: string, input: BookInput) {
  const run = async (db: Db) => {
    if (input.idempotencyKey) {
      const prev = await db.appointment.findFirst({
        where: { organizationId, idempotencyKey: input.idempotencyKey },
      });
      if (prev) {
        const o = await db.organization.findUnique({ where: { id: organizationId }, select: { timezone: true } });
        return { ...serialize(prev, o?.timezone ?? "America/Sao_Paulo"), idempotent: true as const };
      }
    }

    const { durationMin, procedureName } = await resolveDuration(db, organizationId, input);
    if (input.roomId) await assertRoom(db, organizationId, input.roomId);

    const pick = await pickSlotAndProfessional(db, organizationId, {
      start: new Date(input.startAt),
      durationMin,
      professionalId: input.professionalId,
      roomId: input.roomId,
      allowReassign: input.allowReassign ?? true,
    });

    const contact = await resolveContact(db, organizationId, input, !input.dryRun);
    const title = input.title ?? `${procedureName ?? "Atendimento"}${contact ? ` — ${contact.name}` : ""}`;

    if (input.dryRun) {
      return {
        dryRun: true as const,
        written: false as const,
        title,
        start: toTzIso(new Date(input.startAt), pick.timezone),
        end: toTzIso(pick.end, pick.timezone),
        professionalId: pick.professionalId,
        professionalName: pick.professionalName,
        professionalReassigned: pick.reassigned,
      };
    }

    const created = await db.appointment.create({
      data: {
        organizationId,
        title,
        notes: input.notes ?? null,
        startAt: new Date(input.startAt),
        endAt: pick.end,
        contactId: contact?.id ?? null,
        professionalId: pick.professionalId,
        roomId: input.roomId ?? null,
        procedureId: input.procedureId ?? null,
        idempotencyKey: input.idempotencyKey ?? null,
        bookingChannel: input.bookingChannel ?? null,
      },
    });
    await writeAudit(db, organizationId, {
      action: "appointment.created",
      entity: "Appointment",
      entityId: created.id,
      actorId: input.actorId,
      meta: {
        professionalId: pick.professionalId,
        reassigned: pick.reassigned,
        channel: input.bookingChannel ?? null,
      },
    });
    return {
      ...serialize(created, pick.timezone),
      professionalName: pick.professionalName,
      professionalReassigned: pick.reassigned,
      idempotent: false as const,
    };
  };

  try {
    return await prisma.$transaction(run, { isolationLevel: "Serializable" });
  } catch (err) {
    // Duas reservas simultâneas no mesmo horário: o banco recusa uma delas.
    if (typeof err === "object" && err && "code" in err && (err as { code?: string }).code === "P2034") {
      throw new SchedulingError("conflito_concorrente", "horário foi ocupado agora há pouco; consulte a disponibilidade de novo");
    }
    throw err;
  }
}

// ── Cancelar / remarcar / falta ────────────────────────────────────────────

async function findAppointment(db: Db, organizationId: string, id: string) {
  const a = await db.appointment.findFirst({ where: { id, organizationId } });
  if (!a) throw new SchedulingError("agendamento_nao_encontrado", "agendamento não encontrado nesta organização", 404);
  return a;
}

export async function cancelAppointment(
  organizationId: string,
  id: string,
  opts: { reason?: string; actorId?: string } = {}
) {
  const existing = await findAppointment(prisma, organizationId, id);
  if (existing.status === "CANCELLED") return { id, status: "CANCELLED" as const, idempotent: true };
  if (existing.status === "COMPLETED" || existing.status === "NO_SHOW") {
    throw new SchedulingError("status_invalido", `agendamento já está ${existing.status}`);
  }
  if (existing.startAt.getTime() < Date.now()) {
    throw new SchedulingError("reuniao_passada", "não é possível cancelar um atendimento que já passou");
  }

  await prisma.$transaction(async (db) => {
    await db.appointment.update({
      where: { id },
      data: { status: "CANCELLED", cancellationReason: opts.reason ?? null, cancelledAt: new Date() },
    });
    await writeAudit(db, organizationId, {
      action: "appointment.cancelled",
      entity: "Appointment",
      entityId: id,
      actorId: opts.actorId,
      meta: { reason: opts.reason ?? null },
    });
  });

  if (existing.googleEventId && existing.ownerId) {
    await deleteCalendarEvent(existing.ownerId, existing.googleEventId).catch(() => {});
  }
  return { id, status: "CANCELLED" as const, idempotent: false };
}

export async function rescheduleAppointment(
  organizationId: string,
  id: string,
  input: { startAt: string; professionalId?: string; allowReassign?: boolean; actorId?: string }
) {
  const result = await prisma.$transaction(
    async (db) => {
      const existing = await findAppointment(db, organizationId, id);
      if (existing.status !== "SCHEDULED" && existing.status !== "CONFIRMED") {
        throw new SchedulingError("status_invalido", `não é possível remarcar um agendamento ${existing.status}`);
      }
      const durationMin = Math.round((existing.endAt.getTime() - existing.startAt.getTime()) / 60_000);
      const start = new Date(input.startAt);

      const pick = await pickSlotAndProfessional(db, organizationId, {
        start,
        durationMin,
        professionalId: input.professionalId ?? existing.professionalId,
        roomId: existing.roomId,
        allowReassign: input.allowReassign ?? true,
        excludeAppointmentId: id,
      });

      const updated = await db.appointment.update({
        where: { id },
        data: {
          startAt: start,
          endAt: pick.end,
          professionalId: pick.professionalId,
          status: "SCHEDULED",
          rescheduleCount: { increment: 1 },
        },
      });
      await writeAudit(db, organizationId, {
        action: "appointment.rescheduled",
        entity: "Appointment",
        entityId: id,
        actorId: input.actorId,
        meta: { from: existing.startAt.toISOString(), to: start.toISOString(), reassigned: pick.reassigned },
      });
      return { updated, existing, pick };
    },
    { isolationLevel: "Serializable" }
  );

  const { updated, existing, pick } = result;
  if (existing.googleEventId && existing.ownerId) {
    await updateCalendarEvent(existing.ownerId, existing.googleEventId, {
      title: updated.title,
      notes: updated.notes ?? "",
      startAt: updated.startAt,
      endAt: updated.endAt,
    }).catch(() => {});
  }
  return {
    ...serialize(updated, pick.timezone),
    professionalName: pick.professionalName,
    professionalReassigned: pick.reassigned,
  };
}

export async function markNoShow(
  organizationId: string,
  id: string,
  opts: { reason?: string; actorId?: string } = {}
) {
  const existing = await findAppointment(prisma, organizationId, id);
  if (existing.status === "NO_SHOW") return { id, status: "NO_SHOW" as const, idempotent: true };
  if (existing.status === "CANCELLED") {
    throw new SchedulingError("status_invalido", "agendamento cancelado não pode virar falta");
  }
  if (existing.startAt.getTime() > Date.now()) {
    throw new SchedulingError("atendimento_futuro", "o atendimento ainda não aconteceu");
  }

  await prisma.$transaction(async (db) => {
    await db.appointment.update({ where: { id }, data: { status: "NO_SHOW", noShowReason: opts.reason ?? null } });
    await writeAudit(db, organizationId, {
      action: "appointment.no_show",
      entity: "Appointment",
      entityId: id,
      actorId: opts.actorId,
      meta: { reason: opts.reason ?? null },
    });
  });
  return { id, status: "NO_SHOW" as const, idempotent: false };
}
