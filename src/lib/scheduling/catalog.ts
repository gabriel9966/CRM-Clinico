import "server-only";
import { prisma } from "../prisma";
import { SchedulingError, writeAudit } from "./service";

// Cadastros da agenda (profissionais, procedimentos, salas, bloqueios). Tudo
// filtrado por organizationId — a fronteira de isolamento do multi-tenant.

export const listProfessionals = (organizationId: string) =>
  prisma.professional.findMany({ where: { organizationId, active: true }, orderBy: { createdAt: "asc" } });

export const listProcedures = (organizationId: string) =>
  prisma.procedure.findMany({ where: { organizationId, active: true }, orderBy: { name: "asc" } });

export const listRooms = (organizationId: string) =>
  prisma.room.findMany({ where: { organizationId, active: true }, orderBy: { name: "asc" } });

export const listBlocks = (organizationId: string, professionalId?: string) =>
  prisma.scheduleBlock.findMany({
    where: { organizationId, ...(professionalId ? { professionalId } : {}) },
    orderBy: { createdAt: "desc" },
    take: 200,
  });

export async function createProfessional(
  organizationId: string,
  input: {
    name: string;
    specialty?: string;
    color?: string;
    userId?: string;
    workDays?: number[];
    workStartMin?: number;
    workEndMin?: number;
  }
) {
  const start = input.workStartMin ?? 540;
  const end = input.workEndMin ?? 1080;
  if (end <= start) throw new SchedulingError("expediente_invalido", "workEndMin deve ser maior que workStartMin", 400);
  if (input.userId) {
    const user = await prisma.user.findFirst({ where: { id: input.userId, organizationId } });
    if (!user) throw new SchedulingError("usuario_invalido", "usuário não encontrado nesta organização", 404);
  }
  return prisma.professional.create({
    data: {
      organizationId,
      name: input.name,
      specialty: input.specialty,
      color: input.color,
      userId: input.userId,
      workDays: input.workDays,
      workStartMin: start,
      workEndMin: end,
    },
  });
}

export const createProcedure = (
  organizationId: string,
  input: { name: string; durationMin?: number; priceCents?: number; returnIntervalDays?: number }
) => prisma.procedure.create({ data: { organizationId, ...input } });

export async function updateProcedure(
  organizationId: string,
  id: string,
  input: Partial<{
    name: string;
    durationMin: number;
    priceCents: number;
    returnIntervalDays: number;
    kind: "PROCEDURE" | "PRODUCT" | "PACKAGE";
    sessions: number;
    active: boolean;
  }>
) {
  const existing = await prisma.procedure.findFirst({ where: { id, organizationId } });
  if (!existing) throw new SchedulingError("procedimento_invalido", "procedimento não encontrado", 404);
  return prisma.procedure.update({ where: { id }, data: input });
}

export const createRoom =(organizationId: string, input: { name: string }) =>
  prisma.room.create({ data: { organizationId, name: input.name } });

export async function createBlock(
  organizationId: string,
  input: {
    professionalId?: string;
    description?: string;
    isRecurring: boolean;
    date?: string;
    weekday?: number;
    startMin: number;
    endMin: number;
  },
  actorId?: string
) {
  if (input.professionalId) {
    const pro = await prisma.professional.findFirst({ where: { id: input.professionalId, organizationId } });
    if (!pro) throw new SchedulingError("profissional_invalido", "profissional não encontrado", 404);
  }
  return prisma.$transaction(async (db) => {
    const block = await db.scheduleBlock.create({
      data: {
        organizationId,
        professionalId: input.professionalId ?? null,
        description: input.description,
        isRecurring: input.isRecurring,
        date: input.isRecurring ? null : input.date,
        weekday: input.isRecurring ? input.weekday : null,
        startMin: input.startMin,
        endMin: input.endMin,
      },
    });
    await writeAudit(db, organizationId, {
      action: "block.created",
      entity: "ScheduleBlock",
      entityId: block.id,
      actorId,
      meta: { professionalId: input.professionalId ?? null, recurring: input.isRecurring },
    });
    return block;
  });
}

export async function deleteBlock(organizationId: string, id: string, actorId?: string) {
  const block = await prisma.scheduleBlock.findFirst({ where: { id, organizationId } });
  if (!block) throw new SchedulingError("bloqueio_nao_encontrado", "bloqueio não encontrado nesta organização", 404);
  await prisma.$transaction(async (db) => {
    await db.scheduleBlock.delete({ where: { id } });
    await writeAudit(db, organizationId, { action: "block.deleted", entity: "ScheduleBlock", entityId: id, actorId });
  });
  return { ok: true };
}
