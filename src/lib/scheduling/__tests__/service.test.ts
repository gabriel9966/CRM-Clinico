import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockPrisma } from "../../../../test/mock-prisma";

const mockPrisma = createMockPrisma();
vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/providers/google-calendar", () => ({
  updateCalendarEvent: vi.fn().mockResolvedValue(undefined),
  deleteCalendarEvent: vi.fn().mockResolvedValue(undefined),
}));

const { bookAppointment, cancelAppointment, rescheduleAppointment, markNoShow, getAvailability, SchedulingError } =
  await import("../service");

// 2030-01-07 é segunda-feira; 09:00 em São Paulo = 12:00Z.
const DAY = "2030-01-07";
const at = (hhmm: string) => `${DAY}T${hhmm}:00-03:00`;

const org = { timezone: "America/Sao_Paulo", slotStepMin: 30, minLeadMinutes: 10 };
const ana = { id: "ana", name: "Ana", active: true, workDays: [1, 2, 3, 4, 5], workStartMin: 540, workEndMin: 720, createdAt: new Date(0) };
const bia = { ...ana, id: "bia", name: "Bia", createdAt: new Date(1) };

function appt(over: Record<string, unknown> = {}) {
  return {
    id: "a1",
    title: "Limpeza de pele — Maria",
    notes: null,
    startAt: new Date(at("10:00")),
    endAt: new Date(at("11:00")),
    status: "SCHEDULED",
    professionalId: "ana",
    roomId: null,
    procedureId: null,
    contactId: null,
    ownerId: null,
    googleEventId: null,
    ...over,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  mockPrisma.$transaction.mockImplementation(async (cb: (db: typeof mockPrisma) => unknown) => cb(mockPrisma));
  mockPrisma.organization.findUnique.mockResolvedValue(org);
  mockPrisma.professional.findMany.mockResolvedValue([ana]);
  mockPrisma.scheduleBlock.findMany.mockResolvedValue([]);
  mockPrisma.appointment.findMany.mockResolvedValue([]);
  mockPrisma.appointment.findFirst.mockResolvedValue(null);
  mockPrisma.auditLog.create.mockResolvedValue({});
});

describe("getAvailability", () => {
  it("devolve horários com o profissional livre, filtrando por organização", async () => {
    const res = await getAvailability("org-1", { from: DAY, to: DAY, durationMin: 60, limit: 3 });
    expect(res.slots).toHaveLength(3);
    expect(res.slots[0]).toMatchObject({ start: at("09:00"), professionals: [{ id: "ana", name: "Ana" }] });
    expect(mockPrisma.professional.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ organizationId: "org-1" }) })
    );
  });

  it("recusa período maior que 31 dias", async () => {
    await expect(getAvailability("org-1", { from: DAY, to: "2030-03-30" })).rejects.toMatchObject({ code: "periodo_longo" });
  });

  it("recusa data inválida", async () => {
    await expect(getAvailability("org-1", { from: "2030-13-40" })).rejects.toMatchObject({ code: "from_invalido" });
  });
});

describe("bookAppointment", () => {
  it("agenda num horário livre e registra auditoria", async () => {
    mockPrisma.appointment.create.mockImplementation(async ({ data }) => appt({ id: "novo", ...data }));
    const res = await bookAppointment("org-1", { startAt: at("09:00"), durationMin: 60, professionalId: "ana" });
    expect(res).toMatchObject({ id: "novo", idempotent: false, professionalId: "ana" });
    expect(mockPrisma.appointment.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ organizationId: "org-1", professionalId: "ana" }) })
    );
    expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: "appointment.created", organizationId: "org-1" }) })
    );
  });

  it("recusa horário ocupado e não grava", async () => {
    mockPrisma.appointment.findMany.mockResolvedValue([appt({ startAt: new Date(at("09:00")), endAt: new Date(at("10:00")) })]);
    await expect(
      bookAppointment("org-1", { startAt: at("09:00"), durationMin: 60, allowReassign: false })
    ).rejects.toMatchObject({ code: "slot_indisponivel", status: 409 });
    expect(mockPrisma.appointment.create).not.toHaveBeenCalled();
  });

  it("realoca para outro profissional livre quando o pedido está ocupado", async () => {
    mockPrisma.professional.findMany.mockResolvedValue([ana, bia]);
    mockPrisma.appointment.findMany.mockResolvedValue([appt({ startAt: new Date(at("09:00")), endAt: new Date(at("10:00")) })]);
    mockPrisma.appointment.create.mockImplementation(async ({ data }) => appt({ id: "n", ...data }));
    const res = await bookAppointment("org-1", { startAt: at("09:00"), durationMin: 60, professionalId: "ana" });
    expect(res).toMatchObject({ professionalId: "bia", professionalReassigned: true });
  });

  it("com allowReassign=false recusa em vez de trocar o profissional", async () => {
    mockPrisma.professional.findMany.mockResolvedValue([ana, bia]);
    mockPrisma.appointment.findMany.mockResolvedValue([appt({ startAt: new Date(at("09:00")), endAt: new Date(at("10:00")) })]);
    await expect(
      bookAppointment("org-1", { startAt: at("09:00"), durationMin: 60, professionalId: "ana", allowReassign: false })
    ).rejects.toMatchObject({ code: "profissional_ocupado" });
  });

  it("recusa horário fora da grade", async () => {
    await expect(bookAppointment("org-1", { startAt: at("09:10"), durationMin: 60 })).rejects.toMatchObject({
      code: "horario_fora_da_grade",
    });
  });

  it("recusa horário que já passou", async () => {
    await expect(
      bookAppointment("org-1", { startAt: "2020-01-06T09:00:00-03:00", durationMin: 60 })
    ).rejects.toMatchObject({ code: "horario_no_passado" });
  });

  it("recusa profissional de outra organização", async () => {
    await expect(
      bookAppointment("org-1", { startAt: at("09:00"), durationMin: 60, professionalId: "de-outra-org" })
    ).rejects.toMatchObject({ code: "profissional_invalido", status: 404 });
  });

  it("idempotencyKey repetida devolve o mesmo agendamento sem criar outro", async () => {
    mockPrisma.appointment.findFirst.mockResolvedValue(appt({ id: "ja-existe" }));
    const res = await bookAppointment("org-1", { startAt: at("09:00"), durationMin: 60, idempotencyKey: "k1" });
    expect(res).toMatchObject({ id: "ja-existe", idempotent: true });
    expect(mockPrisma.appointment.create).not.toHaveBeenCalled();
    expect(mockPrisma.appointment.findFirst).toHaveBeenCalledWith({ where: { organizationId: "org-1", idempotencyKey: "k1" } });
  });

  it("dryRun valida e não grava nem cria contato", async () => {
    const res = await bookAppointment("org-1", {
      startAt: at("09:00"),
      durationMin: 60,
      dryRun: true,
      contact: { name: "Maria", phone: "+55 11 99999-8888" },
    });
    expect(res).toMatchObject({ dryRun: true, written: false, professionalId: "ana" });
    expect(mockPrisma.appointment.create).not.toHaveBeenCalled();
    expect(mockPrisma.contact.create).not.toHaveBeenCalled();
  });

  it("reaproveita contato existente pelo telefone em vez de duplicar", async () => {
    mockPrisma.contact.findFirst.mockResolvedValue({ id: "c1", name: "Maria" });
    mockPrisma.appointment.create.mockImplementation(async ({ data }) => appt({ id: "n", ...data }));
    await bookAppointment("org-1", { startAt: at("09:00"), durationMin: 60, contact: { name: "Maria", phone: "11999998888" } });
    expect(mockPrisma.contact.create).not.toHaveBeenCalled();
    expect(mockPrisma.appointment.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ contactId: "c1" }) })
    );
  });

  it("converte conflito concorrente do banco (P2034) em erro de agenda", async () => {
    mockPrisma.$transaction.mockRejectedValue(Object.assign(new Error("serialization"), { code: "P2034" }));
    await expect(bookAppointment("org-1", { startAt: at("09:00"), durationMin: 60 })).rejects.toMatchObject({
      code: "conflito_concorrente",
    });
  });
});

describe("cancelAppointment", () => {
  it("cancela atendimento futuro com motivo e auditoria", async () => {
    mockPrisma.appointment.findFirst.mockResolvedValue(appt());
    mockPrisma.appointment.update.mockResolvedValue({});
    const res = await cancelAppointment("org-1", "a1", { reason: "paciente pediu" });
    expect(res).toMatchObject({ status: "CANCELLED", idempotent: false });
    expect(mockPrisma.appointment.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "CANCELLED", cancellationReason: "paciente pediu" }) })
    );
  });

  it("é idempotente: cancelar de novo não altera nada", async () => {
    mockPrisma.appointment.findFirst.mockResolvedValue(appt({ status: "CANCELLED" }));
    const res = await cancelAppointment("org-1", "a1");
    expect(res.idempotent).toBe(true);
    expect(mockPrisma.appointment.update).not.toHaveBeenCalled();
  });

  it("bloqueia cancelamento de atendimento que já passou", async () => {
    mockPrisma.appointment.findFirst.mockResolvedValue(appt({ startAt: new Date("2020-01-06T12:00:00Z") }));
    await expect(cancelAppointment("org-1", "a1")).rejects.toMatchObject({ code: "reuniao_passada" });
  });

  it("não acha agendamento de outra organização", async () => {
    mockPrisma.appointment.findFirst.mockResolvedValue(null);
    await expect(cancelAppointment("org-1", "x")).rejects.toMatchObject({ code: "agendamento_nao_encontrado", status: 404 });
    expect(mockPrisma.appointment.findFirst).toHaveBeenCalledWith({ where: { id: "x", organizationId: "org-1" } });
  });
});

describe("rescheduleAppointment", () => {
  it("move para horário livre mantendo a duração e conta a remarcação", async () => {
    mockPrisma.appointment.findFirst.mockResolvedValue(appt());
    // o próprio atendimento (10h) aparece como ocupado, mas deve ser ignorado
    mockPrisma.appointment.findMany.mockResolvedValue([appt()]);
    mockPrisma.appointment.update.mockImplementation(async ({ data }) => appt({ ...data, rescheduleCount: 1 }));
    const res = await rescheduleAppointment("org-1", "a1", { startAt: at("10:30") });
    expect(res.start).toBe(at("10:30"));
    expect(res.end).toBe(at("11:30"));
    expect(mockPrisma.appointment.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ rescheduleCount: { increment: 1 }, status: "SCHEDULED" }) })
    );
  });

  it("recusa remarcar atendimento cancelado", async () => {
    mockPrisma.appointment.findFirst.mockResolvedValue(appt({ status: "CANCELLED" }));
    await expect(rescheduleAppointment("org-1", "a1", { startAt: at("10:30") })).rejects.toMatchObject({
      code: "status_invalido",
    });
  });
});

describe("markNoShow", () => {
  it("marca falta de atendimento passado com o motivo", async () => {
    mockPrisma.appointment.findFirst.mockResolvedValue(appt({ startAt: new Date("2020-01-06T12:00:00Z") }));
    mockPrisma.appointment.update.mockResolvedValue({});
    const res = await markNoShow("org-1", "a1", { reason: "não avisou" });
    expect(res).toMatchObject({ status: "NO_SHOW", idempotent: false });
    expect(mockPrisma.appointment.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "NO_SHOW", noShowReason: "não avisou" } })
    );
  });

  it("não deixa marcar falta de atendimento futuro", async () => {
    mockPrisma.appointment.findFirst.mockResolvedValue(appt());
    await expect(markNoShow("org-1", "a1")).rejects.toMatchObject({ code: "atendimento_futuro" });
  });
});

it("SchedulingError carrega código e status", () => {
  const e = new SchedulingError("x", "msg", 418);
  expect([e.code, e.status, e.message]).toEqual(["x", 418, "msg"]);
});
