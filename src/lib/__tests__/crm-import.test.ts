import { describe, expect, it } from "vitest";
import { importDate, importMoney, importOptOut, importRows, importTags, phoneKey } from "../crm-import";

describe("importação de CRM", () => {
  it("exige colunas obrigatórias e limite de linhas", () => {
    expect(() => importRows("email\na@x.com", ["name"])).toThrow(/Colunas obrigatórias/);
    expect(importRows("name;email\nAna;a@x.com", ["name"])).toEqual([{ name: "Ana", email: "a@x.com" }]);
  });

  it("interpreta moeda e datas brasileiras sem aceitar valores inválidos", () => {
    expect(importMoney("R$ 1.234,56")).toBe(1234.56);
    expect(importMoney("1234.56")).toBe(1234.56);
    expect(importMoney("abc")).toBeNull();
    expect(importDate("16/10/2026")).toEqual(new Date("2026-10-16T00:00:00.000Z"));
    expect(importDate("2026-02-30")).toBe("invalid");
  });

  it("preserva o bloqueio comercial quando consentimento não foi informado", () => {
    expect(importOptOut("")).toBe(true);
    expect(importOptOut("não")).toBe(false);
    expect(importOptOut("sim")).toBe(true);
    expect(importOptOut("talvez")).toBe("invalid");
  });

  it("normaliza tags e telefone para identificar duplicidade", () => {
    expect(importTags("VIP; Frio,VIP")).toEqual(["VIP", "Frio"]);
    expect(phoneKey("+55 (11) 99999-1234")).toBe("5511999991234");
  });
});
