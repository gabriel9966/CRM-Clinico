import { describe, it, expect } from "vitest";
import { validateFlow } from "../validate-flow";
import type { Flow } from "../types";
const flow = (): Flow => ({ nodes: [{ id: "t", type: "trigger", position: { x: 0, y: 0 }, data: { kind: "trigger", label: "Início" } }, { id: "a", type: "action", position: { x: 1, y: 0 }, data: { kind: "action", actionType: "create_task", config: { title: "Retornar" } } }], edges: [{ id: "e", source: "t", target: "a" }] });
describe("validação de fluxo", () => {
  it("aceita fluxo conectado", () => { expect(() => validateFlow(flow(), true)).not.toThrow(); });
  it("bloqueia ciclo e destino inexistente", () => {
    const cyclic = flow(); cyclic.edges.push({ id: "cycle", source: "a", target: "a" });
    expect(() => validateFlow(cyclic)).toThrow(/ciclo/);
    const invalid = flow(); invalid.edges[0].target = "ausente";
    expect(() => validateFlow(invalid)).toThrow(/ligação/);
  });
  it("permite rascunho, mas impede ativar blocos desconectados", () => {
    const draft = flow(); draft.edges = [];
    expect(() => validateFlow(draft)).not.toThrow();
    expect(() => validateFlow(draft, true)).toThrow(/Conecte/);
  });
});
