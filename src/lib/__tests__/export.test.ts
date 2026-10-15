import { describe, it, expect, vi } from "vitest";
import { csvDownload } from "../export";

describe("csvDownload (exportação em fluxo)", () => {
  it("envia o cabeçalho e junta os lotes em ordem, buscando um lote por vez", async () => {
    const fetchBatch = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ a: "1", b: "x" }, { a: "2", b: "y" }], next: "c2" })
      .mockResolvedValueOnce({ rows: [{ a: "3", b: "z" }], next: null });

    const res = csvDownload("t.csv", ["a", "b"], fetchBatch);
    expect(res.headers.get("content-type")).toContain("text/csv");
    expect(res.headers.get("content-disposition")).toContain('filename="t.csv"');
    expect(res.headers.get("cache-control")).toBe("no-store");

    const text = await res.text();
    expect(text).toBe("a,b\n1,x\n2,y\n3,z\n");
    expect(fetchBatch).toHaveBeenCalledTimes(2);
    expect(fetchBatch).toHaveBeenNthCalledWith(1, null);
    expect(fetchBatch).toHaveBeenNthCalledWith(2, "c2"); // o cursor do lote anterior
  });

  it("base vazia devolve só o cabeçalho", async () => {
    const res = csvDownload("t.csv", ["a"], async () => ({ rows: [], next: null }));
    expect(await res.text()).toBe("a\n");
  });

  it("neutraliza fórmulas também na exportação", async () => {
    const res = csvDownload("t.csv", ["name"], async () => ({ rows: [{ name: "=HYPERLINK(1)" }], next: null }));
    expect(await res.text()).toBe("name\n'=HYPERLINK(1)\n");
  });

  it("erro ao buscar um lote interrompe o download em vez de entregar arquivo truncado como se fosse completo", async () => {
    const res = csvDownload("t.csv", ["a"], async () => {
      throw new Error("banco caiu");
    });
    await expect(res.text()).rejects.toThrow("banco caiu");
  });
});
