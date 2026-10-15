// Datas e horas sempre no fuso da organização (Organization.timezone), nunca no
// do servidor ou do navegador — evita erro na virada do dia. Nunca use
// Date#getHours/getDate para regra de agenda; use estas funções.

export const DEFAULT_TZ = "America/Sao_Paulo";

const pad = (n: number) => String(n).padStart(2, "0");

export function tzParts(d: Date, tz: string = DEFAULT_TZ) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const hourRaw = get("hour") === "24" ? "00" : get("hour");
  const hour = parseInt(hourRaw, 10);
  const minute = parseInt(get("minute"), 10);
  return {
    dateStr: `${get("year")}-${get("month")}-${get("day")}`,
    hour,
    minute,
    minutesOfDay: hour * 60 + minute,
  };
}

// Deslocamento (em minutos) do fuso em relação ao UTC naquele instante.
function offsetMinutes(d: Date, tz: string): number {
  const p = tzParts(d, tz);
  const asUtc = Date.UTC(
    parseInt(p.dateStr.slice(0, 4), 10),
    parseInt(p.dateStr.slice(5, 7), 10) - 1,
    parseInt(p.dateStr.slice(8, 10), 10),
    p.hour,
    p.minute
  );
  return Math.round((asUtc - Math.floor(d.getTime() / 60000) * 60000) / 60000);
}

/** Instante de `YYYY-MM-DD` + minutos desde 00:00, interpretados no fuso `tz`. */
export function tzDateTime(dateStr: string, minutesOfDay: number, tz: string = DEFAULT_TZ): Date {
  const [y, m, d] = dateStr.split("-").map(Number);
  const guess = new Date(Date.UTC(y, m - 1, d, Math.floor(minutesOfDay / 60), minutesOfDay % 60));
  return new Date(guess.getTime() - offsetMinutes(guess, tz) * 60000);
}

/** ISO 8601 com o offset do fuso (ex.: 2026-09-11T17:00:00-03:00). */
export function toTzIso(d: Date, tz: string = DEFAULT_TZ): string {
  const p = tzParts(d, tz);
  const off = offsetMinutes(d, tz);
  const sign = off < 0 ? "-" : "+";
  const a = Math.abs(off);
  return `${p.dateStr}T${pad(p.hour)}:${pad(p.minute)}:00${sign}${pad(Math.floor(a / 60))}:${pad(a % 60)}`;
}

export function addDays(dateStr: string, n: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

/** 0 = domingo … 6 = sábado, para uma data civil (independe de fuso). */
export function weekdayOf(dateStr: string): number {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay();
}

export function isValidDateStr(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export function formatMinutes(min: number): string {
  return `${pad(Math.floor(min / 60))}:${pad(min % 60)}`;
}
