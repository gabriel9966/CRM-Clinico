// Motor de disponibilidade da agenda clínica — funções puras, sem banco.
// Portado (como ideia, não como cópia) do motor de agenda de reuniões usado
// em outra operação: grade de horários, bloqueios pontuais e recorrentes com
// exceções, antecedência mínima e fuso fixo. Adaptado de "closer / hora cheia"
// para "profissional / duração do procedimento".

import { tzDateTime, weekdayOf } from "./time";

export type ProfessionalInput = {
  id: string;
  name: string;
  workDays: number[];
  workStartMin: number;
  workEndMin: number;
};

export type BlockInput = {
  id: string;
  professionalId: string | null; // null = bloqueio da clínica inteira
  isRecurring: boolean;
  date: string | null;
  weekday: number | null;
  startMin: number;
  endMin: number;
};

export type ExceptionInput = { blockId: string; date: string; startMin: number; endMin: number };

export type BusyAppointment = {
  professionalId: string | null;
  roomId: string | null;
  startAt: Date;
  endAt: Date;
};

export type Slot = {
  start: Date;
  end: Date;
  professionalIds: string[];
};

type Segment = { startMin: number; endMin: number };

/** Remove de cada janela as partes liberadas por exceções. */
function subtractExceptions(base: Segment, exceptions: Segment[]): Segment[] {
  let segments = [base];
  for (const ex of exceptions) {
    segments = segments.flatMap((s) => {
      if (ex.endMin <= s.startMin || ex.startMin >= s.endMin) return [s];
      const parts: Segment[] = [];
      if (ex.startMin > s.startMin) parts.push({ startMin: s.startMin, endMin: ex.startMin });
      if (ex.endMin < s.endMin) parts.push({ startMin: ex.endMin, endMin: s.endMin });
      return parts;
    });
  }
  return segments.filter((s) => s.endMin > s.startMin);
}

/**
 * Bloqueios efetivos de uma data, já com exceções aplicadas. Exceção só anula
 * o bloqueio recorrente a que pertence, nunca um bloqueio pontual.
 */
export function resolveBlocksForDate(
  blocks: BlockInput[],
  exceptions: ExceptionInput[],
  dateStr: string
): { professionalId: string | null; startMin: number; endMin: number }[] {
  const weekday = weekdayOf(dateStr);
  const out: { professionalId: string | null; startMin: number; endMin: number }[] = [];
  for (const b of blocks) {
    const applies = b.isRecurring ? b.weekday === weekday : b.date === dateStr;
    if (!applies) continue;
    const exs = b.isRecurring
      ? exceptions.filter((e) => e.blockId === b.id && e.date === dateStr)
      : [];
    for (const s of subtractExceptions({ startMin: b.startMin, endMin: b.endMin }, exs)) {
      out.push({ professionalId: b.professionalId, ...s });
    }
  }
  return out;
}

const overlaps = (aStart: number, aEnd: number, bStart: number, bEnd: number) =>
  aStart < bEnd && bStart < aEnd;

export type ComputeInput = {
  dateStr: string;
  tz: string;
  stepMin: number;
  durationMin: number;
  professionals: ProfessionalInput[];
  blocks: BlockInput[];
  exceptions: ExceptionInput[];
  /** Agendamentos ativos (já sem cancelados/faltas) que cobrem o dia. */
  appointments: BusyAppointment[];
  roomId?: string | null;
  now: Date;
  minLeadMin: number;
};

/** Horários livres de um dia, agrupados por início, com os profissionais livres. */
export function computeDaySlots(input: ComputeInput): Slot[] {
  const { dateStr, tz, stepMin, durationMin, now, minLeadMin } = input;
  if (stepMin <= 0 || durationMin <= 0) return [];

  const weekday = weekdayOf(dateStr);
  const dayBlocks = resolveBlocksForDate(input.blocks, input.exceptions, dateStr);
  const earliest = now.getTime() + minLeadMin * 60_000;
  const byStart = new Map<number, Slot>();

  for (const pro of input.professionals) {
    if (!pro.workDays.includes(weekday)) continue;

    const proBlocks = dayBlocks
      .filter((b) => b.professionalId === null || b.professionalId === pro.id)
      .map((b) => ({
        start: tzDateTime(dateStr, b.startMin, tz).getTime(),
        end: tzDateTime(dateStr, b.endMin, tz).getTime(),
      }));
    const busy = input.appointments.filter(
      (a) => a.professionalId === pro.id || (input.roomId && a.roomId === input.roomId)
    );

    for (let t = pro.workStartMin; t + durationMin <= pro.workEndMin; t += stepMin) {
      const start = tzDateTime(dateStr, t, tz);
      const end = new Date(start.getTime() + durationMin * 60_000);
      if (start.getTime() < earliest) continue;

      const s = start.getTime();
      const e = end.getTime();
      if (proBlocks.some((b) => overlaps(s, e, b.start, b.end))) continue;
      if (busy.some((a) => overlaps(s, e, a.startAt.getTime(), a.endAt.getTime()))) continue;

      const slot = byStart.get(s) ?? { start, end, professionalIds: [] };
      slot.professionalIds.push(pro.id);
      byStart.set(s, slot);
    }
  }

  return [...byStart.values()].sort((a, b) => a.start.getTime() - b.start.getTime());
}

/**
 * Escolhe o profissional livre com menos atendimentos no dia (desempate pela
 * ordem de entrada). Distribui a carga em vez de sempre sugerir o primeiro.
 */
export function pickLeastLoaded(candidateIds: string[], loadByProfessional: Map<string, number>): string | null {
  let best: string | null = null;
  let bestLoad = Infinity;
  for (const id of candidateIds) {
    const load = loadByProfessional.get(id) ?? 0;
    if (load < bestLoad) {
      best = id;
      bestLoad = load;
    }
  }
  return best;
}
