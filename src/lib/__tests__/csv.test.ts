import { describe, it, expect } from "vitest";
import { toCsv, parseCsv, parseCsvTable, neutralizeFormula } from "../csv";

describe("toCsv", () => {
  it("escapa campos com vírgula, aspas e quebra de linha", () => {
    const csv = toCsv([{ name: "Ana, Silva", note: 'disse "oi"\nlinha2' }], ["name", "note"]);
    expect(csv).toBe('name,note\n"Ana, Silva","disse ""oi""\nlinha2"');
  });

  it("round-trips com parseCsv", () => {
    const rows = [{ name: "Maria", company: "Acme, Inc." }, { name: "João", company: "" }];
    const csv = toCsv(rows, ["name", "company"]);
    const parsed = parseCsv(csv);
    expect(parsed).toEqual([
      { name: "Maria", company: "Acme, Inc." },
      { name: "João", company: "" },
    ]);
  });
});

describe("proteção contra injeção de fórmula em planilhas", () => {
  it("prefixa ' em células que começam com = @ ou com +/- seguidos de texto", () => {
    expect(neutralizeFormula("=HYPERLINK(\"http://x\")")).toBe("'=HYPERLINK(\"http://x\")");
    expect(neutralizeFormula("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(neutralizeFormula("+cmd|' /C calc'!A0")).toBe("'+cmd|' /C calc'!A0");
    expect(neutralizeFormula("-2+3+cmd")).toBe("'-2+3+cmd");
    expect(neutralizeFormula("\tTAB")).toBe("'\tTAB");
  });

  it("não mexe em telefone, número negativo nem texto comum", () => {
    expect(neutralizeFormula("+5511999990000")).toBe("+5511999990000");
    expect(neutralizeFormula("+55 (11) 99999-0000")).toBe("+55 (11) 99999-0000");
    expect(neutralizeFormula("-12,5")).toBe("-12,5");
    expect(neutralizeFormula("Maria = ótima")).toBe("Maria = ótima");
    expect(neutralizeFormula("")).toBe("");
  });

  it("toCsv aplica a proteção só em texto (números ficam intactos)", () => {
    const csv = toCsv([{ name: "=1+1", value: -5, phone: "+5511999990000" }], ["name", "value", "phone"]);
    expect(csv).toBe("name,value,phone\n'=1+1,-5,+5511999990000");
  });
});

describe("parseCsv", () => {
  it("aceita CSV do Excel com BOM e ponto e vírgula", () => {
    expect(parseCsvTable('\uFEFFnome;empresa;nota\nAna;"Loja; Sul";VIP')).toEqual({
      headers: ["nome", "empresa", "nota"],
      rows: [{ nome: "Ana", empresa: "Loja; Sul", nota: "VIP" }],
    });
  });

  it("rejeita aspas não fechadas", () => {
    expect(() => parseCsv('name,email\n"Ana,ana@x.com')).toThrow(/aspas não fechadas/);
  });
  it("ignora linhas em branco", () => {
    expect(parseCsv("name,email\n\nAna,ana@x.com\n\n")).toEqual([{ name: "Ana", email: "ana@x.com" }]);
  });

  it("retorna lista vazia para entrada vazia", () => {
    expect(parseCsv("")).toEqual([]);
  });

  it("suporta campo entre aspas com vírgula interna", () => {
    expect(parseCsv('name,tags\nMaria,"VIP,E-commerce"')).toEqual([{ name: "Maria", tags: "VIP,E-commerce" }]);
  });
});
