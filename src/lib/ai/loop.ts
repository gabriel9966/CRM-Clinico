import { supportsRefusalFallback } from "./models";
import type { ToolDef, ToolResult } from "./tools";

// Laço do agente (chamada à API → ferramentas → chamada…). Não conhece banco nem
// canal: recebe a API e o executor de ferramentas, então é testável com um
// cliente falso. A chamada real usa o SDK oficial (ver agent.ts).

export type ContentBlock = { type: string; [key: string]: unknown };
export type ApiMessage = { role: "user" | "assistant"; content: string | ContentBlock[] };

export type ApiResponse = {
  content: ContentBlock[];
  stop_reason: string | null;
  usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null };
};

export type MessagesApi = { create: (body: Record<string, unknown>) => Promise<ApiResponse> };

export type LoopOutcome = "replied" | "refusal" | "truncated" | "max_steps" | "no_text";

export type LoopResult = {
  outcome: LoopOutcome;
  text: string;
  steps: number;
  usage: { input: number; output: number; cacheRead: number };
  trace: { tool: string; input: unknown; result: string; isError: boolean }[];
};

export type LoopInput = {
  api: MessagesApi;
  model: string;
  effort: string;
  system: { type: "text"; text: string }[];
  messages: ApiMessage[];
  tools: ToolDef[];
  execute: (name: string, input: unknown) => Promise<ToolResult>;
  maxSteps: number;
  maxTokens?: number;
};

const textOf = (content: ContentBlock[]) =>
  content
    .filter((b) => b.type === "text" && typeof b.text === "string")
    .map((b) => (b.text as string).trim())
    .filter(Boolean)
    .join("\n\n");

export async function runAgentLoop(input: LoopInput): Promise<LoopResult> {
  const messages: ApiMessage[] = [...input.messages];
  const usage = { input: 0, output: 0, cacheRead: 0 };
  const trace: LoopResult["trace"] = [];
  const maxSteps = Math.min(Math.max(input.maxSteps, 1), 10);

  const base: Record<string, unknown> = {
    model: input.model,
    // O raciocínio (thinking) também conta em max_tokens; deixa folga para a resposta.
    max_tokens: input.maxTokens ?? 6000,
    system: input.system,
    tools: input.tools,
    cache_control: { type: "ephemeral" },
    output_config: { effort: input.effort },
    // Em recusa por política, a API refaz o pedido num modelo de reserva (nada a manter à mão).
    ...(supportsRefusalFallback(input.model) ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" } : {}),
  };

  for (let step = 1; step <= maxSteps; step++) {
    const response = await input.api.create({ ...base, messages });
    usage.input += (response.usage?.input_tokens ?? 0) + (response.usage?.cache_creation_input_tokens ?? 0);
    usage.output += response.usage?.output_tokens ?? 0;
    usage.cacheRead += response.usage?.cache_read_input_tokens ?? 0;

    // Recusa pode cortar um tool_use no meio: nunca executar as ferramentas desse turno.
    if (response.stop_reason === "refusal") return { outcome: "refusal", text: "", steps: step, usage, trace };

    const toolUses = response.content.filter((b) => b.type === "tool_use");
    if (toolUses.length === 0 || response.stop_reason !== "tool_use") {
      const text = textOf(response.content);
      if (response.stop_reason === "max_tokens" && !text) return { outcome: "truncated", text: "", steps: step, usage, trace };
      return { outcome: text ? "replied" : "no_text", text, steps: step, usage, trace };
    }

    // O turno do assistente volta INTEIRO (inclusive blocos de raciocínio), sem edição.
    messages.push({ role: "assistant", content: response.content });
    const results: ContentBlock[] = [];
    for (const block of toolUses) {
      const name = String(block.name ?? "");
      const result = await input.execute(name, block.input);
      trace.push({ tool: name, input: block.input, result: result.content.slice(0, 600), isError: !!result.isError });
      results.push({ type: "tool_result", tool_use_id: block.id, content: result.content, ...(result.isError ? { is_error: true } : {}) });
    }
    messages.push({ role: "user", content: results });
  }

  return { outcome: "max_steps", text: "", steps: maxSteps, usage, trace };
}
