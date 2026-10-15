import { describe, it, expect } from "vitest";
import {
  computeDaySlots,
  pickLeastLoaded,
  resolveBlocksForDate,
  type BlockInput,
  type ProfessionalInput,
} from "../availability";
import { tzDateTime, tzParts, toTzIso, weekdayOf, addDays } from "../time";

const TZ = "America/Sao_Paulo";
// 2026-09-14 é segunda-feira.
const MONDAY = "2026-09-14";
const NOW = new Date("2026-09-01T12:00:00Z"); // bem antes, sem efeito

const ana: ProfessionalInput = { id: "ana", name: "Ana", workDays: [1, 2, 3, 4, 5], workStartMin: 9 * 60, workEndMin: 12 * 60 };
const bia: ProfessionalInput = { id: "bia", name: "Bia", workDays: [1, 2, 3, 4, 5], workStartMin: 9 * 60, workEndMin: 12 * 60 };

const base = {
  dateStr: MONDAY,
  tz: TZ,
  stepMin: 30,
  durationMin: 60,
  blocks: [] as BlockInput[],
  exceptions: [],
  appointments: [],
  now: NOW,
  minLeadMin: 10,
};

const hhmm = (d: Date) => {
  const p = tzParts(d, TZ);
  return `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
};

describe("time", () => {
  it("converte data+minutos no fuso para o instante certo (UTC-3)", () => {
    expect(tzDateTime(MONDAY, 9 * 60, TZ).toISOString()).toBe("2026-09-14T12:00:00.000Z");
    expect(toTzIso(new Date("2026-09-14T12:00:00Z"), TZ)).toBe("2026-09-14T09:00:00-03:00");
  });

  it("usa a data do fuso na virada do dia, não a do UTC", () => {
    // 01:00 UTC de 15/09 ainda é 22:00 de 14/09 em São Paulo.
    expect(tzParts(new Date("2026-09-15T01:00:00Z"), TZ).dateStr).toBe("2026-09-14");
  });

  it("calcula dia da semana e soma de dias", () => {
    expect(weekdayOf(MONDAY)).toBe(1);
    expect(addDays("2026-09-30", 1)).toBe("2026-10-01");
  });
});

describe("computeDaySlots", () => {
  it("gera a grade respeitando duração e fim do expediente", () => {
    const slots = computeDaySlots({ ...base, professionals: [ana] });
    // 09:00..11:00 de 30 em 30 (11:00 + 60min = 12:00, limite do expediente)
    expect(slots.map((s) => hhmm(s.start))).toEqual(["09:00", "09:30", "10:00", "10:30", "11:00"]);
  });

  it("não oferece dia fora do expediente do profissional", () => {
    const sunday = "2026-09-13";
    expect(computeDaySlots({ ...base, dateStr: sunday, professionals: [ana] })).toEqual([]);
  });

  it("remove horários que se sobrepõem a um agendamento existente", () => {
    const slots = computeDaySlots({
      ...base,
      professionals: [ana],
      appointments: [
        { professionalId: "ana", roomId: null, startAt: tzDateTime(MONDAY, 10 * 60, TZ), endAt: tzDateTime(MONDAY, 11 * 60, TZ) },
      ],
    });
    // 09:30 (até 10:30), 10:00 e 10:30 colidem com o atendimento das 10h
    expect(slots.map((s) => hhmm(s.start))).toEqual(["09:00", "11:00"]);
  });

  it("agrupa os profissionais livres por horário e tira só o ocupado", () => {
    const slots = computeDaySlots({
      ...base,
      professionals: [ana, bia],
      appointments: [
        { professionalId: "ana", roomId: null, startAt: tzDateTime(MONDAY, 9 * 60, TZ), endAt: tzDateTime(MONDAY, 10 * 60, TZ) },
      ],
    });
    const nine = slots.find((s) => hhmm(s.start) === "09:00")!;
    expect(nine.professionalIds).toEqual(["bia"]);
    const ten = slots.find((s) => hhmm(s.start) === "10:00")!;
    expect(ten.professionalIds).toEqual(["ana", "bia"]);
  });

  it("respeita a antecedência mínima", () => {
    const now = tzDateTime(MONDAY, 8 * 60 + 55, TZ); // 08:55
    const slots = computeDaySlots({ ...base, professionals: [ana], now, minLeadMin: 10 });
    expect(hhmm(slots[0].start)).toBe("09:30"); // 09:00 está a 5 min — cedo demais
  });

  it("bloqueio da clínica inteira vale para todos", () => {
    const lunch: BlockInput = { id: "b1", professionalId: null, isRecurring: false, date: MONDAY, weekday: null, startMin: 10 * 60, endMin: 11 * 60 };
    const slots = computeDaySlots({ ...base, professionals: [ana, bia], blocks: [lunch] });
    // 09:30–10:30 invade o bloqueio; 09:00–10:00 e 11:00–12:00 cabem fora dele
    expect(slots.map((s) => hhmm(s.start))).toEqual(["09:00", "11:00"]);
    expect(slots[0].professionalIds).toEqual(["ana", "bia"]);
  });

  it("bloqueio de um profissional não afeta o outro", () => {
    const folga: BlockInput = { id: "b2", professionalId: "ana", isRecurring: false, date: MONDAY, weekday: null, startMin: 9 * 60, endMin: 12 * 60 };
    const slots = computeDaySlots({ ...base, professionals: [ana, bia], blocks: [folga] });
    expect(slots.every((s) => s.professionalIds.join() === "bia")).toBe(true);
    expect(slots.length).toBe(5);
  });

  it("sala ocupada bloqueia o horário mesmo com profissional livre", () => {
    const slots = computeDaySlots({
      ...base,
      professionals: [ana],
      roomId: "sala1",
      appointments: [
        { professionalId: "bia", roomId: "sala1", startAt: tzDateTime(MONDAY, 9 * 60, TZ), endAt: tzDateTime(MONDAY, 10 * 60, TZ) },
      ],
    });
    expect(slots.map((s) => hhmm(s.start))).toEqual(["10:00", "10:30", "11:00"]);
  });
});

describe("resolveBlocksForDate", () => {
  const weekly: BlockInput = { id: "r1", professionalId: "ana", isRecurring: true, date: null, weekday: 1, startMin: 12 * 60, endMin: 14 * 60 };

  it("bloqueio recorrente vale no dia da semana certo", () => {
    expect(resolveBlocksForDate([weekly], [], MONDAY)).toHaveLength(1);
    expect(resolveBlocksForDate([weekly], [], "2026-09-15")).toHaveLength(0);
  });

  it("exceção libera só a janela indicada, partindo o bloqueio", () => {
    const out = resolveBlocksForDate([weekly], [{ blockId: "r1", date: MONDAY, startMin: 13 * 60, endMin: 14 * 60 }], MONDAY);
    expect(out).toEqual([{ professionalId: "ana", startMin: 12 * 60, endMin: 13 * 60 }]);
  });

  it("exceção cobrindo tudo remove o bloqueio naquela data, mas não nas outras", () => {
    const ex = [{ blockId: "r1", date: MONDAY, startMin: 12 * 60, endMin: 14 * 60 }];
    expect(resolveBlocksForDate([weekly], ex, MONDAY)).toHaveLength(0);
    expect(resolveBlocksForDate([weekly], ex, addDays(MONDAY, 7))).toHaveLength(1);
  });

  it("exceção nunca anula bloqueio pontual", () => {
    const once: BlockInput = { id: "p1", professionalId: "ana", isRecurring: false, date: MONDAY, weekday: null, startMin: 9 * 60, endMin: 10 * 60 };
    const out = resolveBlocksForDate([once], [{ blockId: "p1", date: MONDAY, startMin: 9 * 60, endMin: 10 * 60 }], MONDAY);
    expect(out).toHaveLength(1);
  });
});

describe("pickLeastLoaded", () => {
  it("escolhe quem tem menos atendimentos e desempata pela ordem", () => {
    expect(pickLeastLoaded(["a", "b", "c"], new Map([["a", 3], ["b", 1], ["c", 1]]))).toBe("b");
    expect(pickLeastLoaded([], new Map())).toBeNull();
  });
});
