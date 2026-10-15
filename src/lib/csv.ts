// CSV simples, sem dependências: suporta campos entre aspas com vírgula/
// quebra de linha dentro, e aspas escapadas como "" (padrão RFC 4180).

// Planilhas (Excel/Sheets) executam células que começam com = + - @ como
// fórmula. Nomes vindos de fora (ex.: o nome do perfil do WhatsApp) são
// controlados por quem escreve a mensagem, então neutralizamos com um ' na
// frente. Telefones e números ("+5511999990000", "-12,5") não são fórmula e
// ficam como estão.
const PLAIN_NUMBER = /^[+-][\d\s().,-]+$/;
export function neutralizeFormula(s: string): string {
  if (/^[=@\t\r]/.test(s)) return `'${s}`;
  if (/^[+-]/.test(s) && !PLAIN_NUMBER.test(s)) return `'${s}`;
  return s;
}

function escapeCell(v: unknown): string {
  let s = v === null || v === undefined ? "" : String(v);
  if (typeof v === "string") s = neutralizeFormula(s);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function csvHeader(columns: string[]): string {
  return columns.map(escapeCell).join(",");
}

export function csvLine(row: Record<string, unknown>, columns: string[]): string {
  return columns.map((c) => escapeCell(row[c])).join(",");
}

export function toCsv(rows: Record<string, unknown>[], columns: string[]): string {
  return [csvHeader(columns), ...rows.map((r) => csvLine(r, columns))].join("\n");
}

export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  const src = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += ch;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  const nonEmpty = rows.filter((r) => r.some((c) => c.trim() !== ""));
  if (nonEmpty.length === 0) return [];
  const header = nonEmpty[0].map((h) => h.trim());
  return nonEmpty.slice(1).map((r) => {
    const obj: Record<string, string> = {};
    header.forEach((h, i) => {
      obj[h] = (r[i] ?? "").trim();
    });
    return obj;
  });
}
