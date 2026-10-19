import { describe, expect, it, vi } from "vitest";
import { buildHistory, buildSystemBlocks, clampReply, endsWithCustomer } from "../prompt";
import { runAgentLoop, type ApiResponse, type MessagesApi } from "../loop";
import { toolDefsFor } from "../tools";
import { parseToolNames } from "../models";

describe("buildHistory", () => {
  it("mapeia cliente→user e equipe/bot→assistant, junta turnos seguidos e começa pelo cliente", () => {
    const turns = buildHistory(
      [
        { direction: "out", text: "Oi! Posso ajudar?" },
        { direction: "in", text: "Oi" },
        { direction: "in", text: "quero agendar" },
        { direction: "out", text: "Claro" },
        { direction: "in", text: "sexta" },
      ],
      20
    );
    expect(turns).toEqual([
      { role: "user", content: "Oi\nquero agendar" },
      { role: "assistant", content: "Claro" },
      { role: "user", content: "sexta" },
    ]);
    expect(endsWithCustomer(turns)).toBe(true);
  });

  it("respeita o limite, corta mensagens enormes e ignora vazias", () => {
    const rows = [{ direction: "in", text: "   " }, ...Array.from({ length: 30 }, (_, i) => ({ direction: i % 2 ? "out" : "in", text: `m${i}` }))];
    expect(buildHistory(rows, 6).length).toBeLessThanOrEqual(6);
    expect(buildHistory([{ direction: "in", text: "x".repeat(5000) }], 5)[0].content).toHaveLength(2000);
  });

  it("não há o que responder quando a equipe falou por último", () => {
    expect(endsWithCustomer(buildHistory([{ direction: "in", text: "oi" }, { direction: "out", text: "olá" }], 10))).toBe(false);
  });
});

describe("prompt do sistema", () => {
  it("traz as regras de segurança e trata a mensagem do cliente como dado não confiável", () => {
    const [stable, dynamic] = buildSystemBlocks({ orgName: "Clínica Sol", timezone: "America/Sao_Paulo", now: new Date("2026-10-20T15:00:00Z"), instructions: "Atendemos de seg a sex.", contactFirstName: "Marina", channelLabel: "WhatsApp" });
    expect(stable.text).toContain("dados não confiáveis");
    expect(stable.text).toContain("handoff_to_human");
    expect(stable.text).toContain("Atendemos de seg a sex.");
    expect(dynamic.text).toContain("Marina");
    expect(dynamic.text).toContain("2026");
    // a parte estável não pode conter nada volátil (cache de prompt)
    expect(stable.text).not.toContain("Marina");
  });

  it("clampReply corta no fim de uma frase", () => {
    const long = "Primeira frase. ".repeat(200);
    const out = clampReply(long, 100);
    expect(out.length).toBeLessThanOrEqual(100);
    expect(out.endsWith(".")).toBe(true);
  });
});

describe("ferramentas expostas ao modelo", () => {
  it("só as liberadas existem, e passar para humano é sempre incluída", () => {
    const names = toolDefsFor(["list_procedures"]).map((t) => t.name);
    expect(names).toEqual(["list_procedures", "handoff_to_human"]);
    expect(toolDefsFor([]).map((t) => t.name)).toEqual(["handoff_to_human"]);
  });

  it("nenhuma ferramenta pede o id do contato (ele vem sempre da conversa)", () => {
    for (const def of toolDefsFor(["get_contact", "save_contact_info", "book_appointment", "reschedule_appointment", "cancel_appointment", "create_follow_up_task", "list_my_appointments"])) {
      expect(JSON.stringify(def.input_schema)).not.toMatch(/contactId/);
      expect(def.strict).toBe(true);
    }
  });

  it("parseToolNames ignora nomes inventados e JSON inválido", () => {
    expect(parseToolNames('["get_contact","hack","book_appointment"]')).toEqual(["get_contact", "book_appointment"]);
    expect(parseToolNames("{")).toEqual([]);
  });
});

const usage = { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 2 };
const text = (t: string): ApiResponse => ({ content: [{ type: "text", text: t }], stop_reason: "end_turn", usage });
const toolUse = (id: string, name: string, input: unknown): ApiResponse => ({
  content: [{ type: "thinking", thinking: "", signature: "sig" }, { type: "tool_use", id, name, input }],
  stop_reason: "tool_use",
  usage,
});

function apiOf(...responses: ApiResponse[]) {
  const create = vi.fn<MessagesApi["create"]>();
  for (const r of responses) create.mockResolvedValueOnce(r);
  return { api: { create } as MessagesApi, create };
}

const base = {
  model: "claude-opus-5-5",
  effort: "medium",
  system: [{ type: "text" as const, text: "sys" }],
  messages: [{ role: "user" as const, content: "oi" }],
  tools: toolDefsFor(["list_procedures"]),
  maxSteps: 4,
};

describe("runAgentLoop", () => {
  it("responde direto quando o modelo não chama ferramentas", async () => {
    const { api, create } = apiOf(text("Olá!"));
    const result = await runAgentLoop({ ...base, api, execute: vi.fn() });
    expect(result).toMatchObject({ outcome: "replied", text: "Olá!", steps: 1, usage: { input: 10, output: 5, cacheRead: 2 } });
    const body = create.mock.calls[0][0];
    expect(body).toMatchObject({ model: "claude-opus-5-5", output_config: { effort: "medium" }, cache_control: { type: "ephemeral" }, fallbacks: "default" });
    expect(body.betas).toEqual(["server-side-fallback-2026-07-01"]);
    expect(body).not.toHaveProperty("thinking"); // Opus 5.5: raciocínio sempre ligado, não se configura
    expect(body).not.toHaveProperty("tool_choice"); // forçar ferramenta dá 400 no Opus 5.5
  });

  it("executa ferramentas, devolve os resultados em UMA mensagem e preserva o turno do assistente inteiro", async () => {
    const execute = vi.fn().mockResolvedValue({ content: '[{"id":"p1"}]' });
    const { api, create } = apiOf(toolUse("t1", "list_procedures", {}), text("Temos limpeza de pele."));
    const result = await runAgentLoop({ ...base, api, execute });
    expect(result.outcome).toBe("replied");
    expect(result.steps).toBe(2);
    expect(result.trace).toEqual([{ tool: "list_procedures", input: {}, result: '[{"id":"p1"}]', isError: false }]);
    const second = create.mock.calls[1][0].messages as { role: string; content: unknown }[];
    expect(second[1]).toMatchObject({ role: "assistant" });
    expect((second[1].content as { type: string }[]).map((b) => b.type)).toEqual(["thinking", "tool_use"]);
    expect(second[2]).toEqual({ role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: '[{"id":"p1"}]' }] });
  });

  it("marca erro de ferramenta com is_error para o modelo se corrigir", async () => {
    const execute = vi.fn().mockResolvedValue({ content: '{"error":"slot_indisponivel"}', isError: true });
    const { api, create } = apiOf(toolUse("t1", "list_procedures", {}), text("Esse horário acabou de ser ocupado."));
    await runAgentLoop({ ...base, api, execute });
    const results = (create.mock.calls[1][0].messages as { content: { is_error?: boolean }[] }[])[2].content;
    expect(results[0].is_error).toBe(true);
  });

  it("recusa do modelo: encerra sem executar nenhuma ferramenta", async () => {
    const execute = vi.fn();
    const { api } = apiOf({ content: [{ type: "tool_use", id: "t1", name: "list_procedures", input: {} }], stop_reason: "refusal", usage });
    const result = await runAgentLoop({ ...base, api, execute });
    expect(result.outcome).toBe("refusal");
    expect(execute).not.toHaveBeenCalled();
  });

  it("para ao exceder o limite de passos", async () => {
    const execute = vi.fn().mockResolvedValue({ content: "{}" });
    const { api, create } = apiOf(...Array.from({ length: 10 }, (_, i) => toolUse(`t${i}`, "list_procedures", {})));
    const result = await runAgentLoop({ ...base, api, execute, maxSteps: 3 });
    expect(result.outcome).toBe("max_steps");
    expect(create).toHaveBeenCalledTimes(3);
  });

  it("corte por max_tokens sem texto vira 'truncated'; Haiku não pede fallback", async () => {
    const { api, create } = apiOf({ content: [{ type: "thinking", thinking: "", signature: "s" }], stop_reason: "max_tokens", usage });
    const result = await runAgentLoop({ ...base, model: "claude-haiku-5-5", api, execute: vi.fn() });
    expect(result.outcome).toBe("truncated");
    expect(create.mock.calls[0][0]).not.toHaveProperty("fallbacks");
  });
});
