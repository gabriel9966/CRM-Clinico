import { parseCsvTable } from "@/lib/csv";

export const MAX_IMPORT_ROWS = 3000;
export const MAX_IMPORT_CHARS = 750_000;

export function importRows(csvText: string, requiredHeaders: string[]): Record<string, string>[] {
  if (csvText.length > MAX_IMPORT_CHARS) throw new Error("CSV muito grande. Divida o arquivo em partes de até 750 KB.");
  const { headers, rows } = parseCsvTable(csvText);
  const missing = requiredHeaders.filter((header) => !headers.includes(header));
  if (missing.length) throw new Error(`Colunas obrigatórias ausentes: ${missing.join(", ")}.`);
  if (!rows.length) throw new Error("O CSV não contém linhas de dados.");
  if (rows.length > MAX_IMPORT_ROWS) throw new Error(`Importe até ${MAX_IMPORT_ROWS} linhas por vez.`);
  return rows;
}

export function importTags(value: string): string[] {
  return [...new Set(value.split(/[;,]/).map((tag) => tag.trim()).filter(Boolean))];
}

export function importMoney(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return 0;
  const cleaned = trimmed.replace(/R\$/gi, "").replace(/\s/g, "");
  const normalized = cleaned.includes(",")
    ? cleaned.replace(/\./g, "").replace(",", ".")
    : cleaned;
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

export function importDate(value: string): Date | null | "invalid" {
  const trimmed = value.trim();
  if (!trimmed) return null;
  let year: number;
  let month: number;
  let day: number;
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    [year, month, day] = trimmed.split("-").map(Number);
  } else if (/^\d{2}\/\d{2}\/\d{4}$/.test(trimmed)) {
    [day, month, year] = trimmed.split("/").map(Number);
  } else return "invalid";
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? date : "invalid";
}

export function importOptOut(value: string): boolean | "invalid" {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return true; // sem consentimento explícito, não liberar campanhas
  if (["1", "sim", "s", "true", "yes", "y"].includes(normalized)) return true;
  if (["0", "não", "nao", "n", "false", "no"].includes(normalized)) return false;
  return "invalid";
}

export const phoneKey = (phone: string) => phone.replace(/\D/g, "");
