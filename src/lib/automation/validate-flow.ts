import { ACTION_LABEL, type Flow } from "./types";

export function validateFlow(flow: Flow, ready = false) {
  if (!flow || !Array.isArray(flow.nodes) || !Array.isArray(flow.edges) || flow.nodes.length > 200 || flow.edges.length > 400 || JSON.stringify(flow).length > 512_000) throw new Error("Fluxo inválido ou muito grande.");
  const ids = new Set<string>();
  for (const node of flow.nodes) {
    if (!node || typeof node.id !== "string" || !node.id || ids.has(node.id) || !node.data) throw new Error("Há blocos inválidos ou com identificador duplicado.");
    ids.add(node.id);
    const data = node.data;
    if (!["trigger", "action", "delay", "condition", "code"].includes(data.kind)) throw new Error("Tipo de bloco inválido.");
    if (data.kind === "action" && (!Object.hasOwn(ACTION_LABEL, data.actionType) || !data.config || Array.isArray(data.config))) throw new Error("Ação inválida.");
    if (data.kind === "delay" && (!Number.isFinite(data.amount) || data.amount < 0 || data.amount > 36500 || !["minutes", "hours", "days"].includes(data.unit))) throw new Error("Configure uma espera válida.");
    if (data.kind === "code" && (typeof data.code !== "string" || data.code.length > 64000)) throw new Error("Código inválido ou maior que 64.000 caracteres.");
  }
  const triggers = flow.nodes.filter((node) => node.data.kind === "trigger");
  if (triggers.length !== 1) throw new Error("O fluxo precisa de exatamente um gatilho.");
  const outputs = new Set<string>();
  for (const edge of flow.edges) {
    if (!ids.has(edge.source) || !ids.has(edge.target) || edge.target === triggers[0].id) throw new Error("Há uma ligação inválida no fluxo.");
    const source = flow.nodes.find((node) => node.id === edge.source)!;
    const key = `${edge.source}:${source.data.kind === "condition" ? edge.sourceHandle ?? "" : "default"}`;
    if (outputs.has(key)) throw new Error("Uma saída deve ter apenas um próximo bloco.");
    outputs.add(key);
    if (source.data.kind === "condition" && !["true", "false"].includes(edge.sourceHandle || "")) throw new Error("Ligue a saída Sim ou Não da condição.");
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  function visit(id: string) {
    if (visiting.has(id)) throw new Error("O fluxo contém um ciclo. Remova a ligação que volta a um bloco anterior.");
    if (visited.has(id)) return;
    visiting.add(id);
    for (const edge of flow.edges.filter((item) => item.source === id)) visit(edge.target);
    visiting.delete(id); visited.add(id);
  }
  for (const id of ids) visit(id);
  if (ready) {
    const reachable = new Set<string>();
    function reach(id: string) { if (reachable.has(id)) return; reachable.add(id); for (const edge of flow.edges.filter((item) => item.source === id)) reach(edge.target); }
    reach(triggers[0].id);
    if (reachable.size < 2) throw new Error("Conecte ao menos uma ação ao gatilho antes de ativar.");
    if (reachable.size !== ids.size) throw new Error("Há blocos desconectados. Conecte-os ou remova-os antes de ativar.");
  }
}
