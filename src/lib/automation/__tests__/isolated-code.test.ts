import { describe, it, expect } from "vitest";
import { executeIsolatedCode } from "../isolated-code";

describe("JavaScript isolado", () => {
  it("executa funções CRM assíncronas e recebe apenas JSON", async () => {
    const result = await executeIsolatedCode("const contact = await crm.getContact(payload.id); return { name: contact.name, env: typeof process, require: typeof require };", { payload: { id: "c1" } }, { getContact: async () => ({ name: "Maria" }) }, () => {});
    expect(result).toEqual({ name: "Maria", env: "undefined", require: "undefined" });
  });
  it("não permite escapar pelo construtor da função exposta", async () => {
    await expect(executeIsolatedCode('return crm.log.constructor("return process.env")();', {}, {}, () => {})).rejects.toThrow();
  });
  it("encerra loop infinito com limite de tempo", async () => {
    await expect(executeIsolatedCode("while (true) {}", {}, {}, () => {}, 50)).rejects.toThrow();
  });
  it("encerra uma promessa que nunca termina", async () => {
    await expect(executeIsolatedCode("await new Promise(() => {});", {}, {}, () => {}, 50)).rejects.toThrow(/Tempo/);
  });
});
