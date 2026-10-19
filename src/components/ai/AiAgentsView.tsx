"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Icon } from "@/components/icons";
import type { AiAgentDTO } from "@/lib/ai/queries";
import { AI_EFFORTS, AI_MODELS, AI_TOOLS, DEFAULT_AI_MODEL, DEFAULT_INSTRUCTIONS, type AiToolName } from "@/lib/ai/models";
import {
  chatWithAiAgent,
  checkAiAgentConnection,
  createAiBotAutomation,
  deleteAiAgent,
  saveAiAgent,
  type AiAgentInput,
} from "@/app/ai/actions";

const modelLabel = (id: string) => AI_MODELS.find((m) => m.id === id)?.label.split(" — ")[0] ?? id;
const fmtTokens = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : String(n));

const EMPTY: AiAgentInput = {
  name: "Atendente virtual",
  enabled: true,
  model: DEFAULT_AI_MODEL,
  effort: "medium",
  systemPrompt: DEFAULT_INSTRUCTIONS,
  apiKey: "",
  tools: AI_TOOLS.filter((t) => t.defaultOn).map((t) => t.name),
  maxToolSteps: 6,
  historyLimit: 20,
  replyLimitPerHour: 20,
  dailyTokenLimit: 0,
  handoffMessage: "Vou chamar um atendente para continuar com você. Já já alguém responde por aqui.",
};

export function AiAgentsView({ agents }: { agents: AiAgentDTO[] }) {
  const router = useRouter();
  const [form, setForm] = useState<{ agent: AiAgentDTO | null } | null>(null);
  const [testing, setTesting] = useState<AiAgentDTO | null>(null);
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function act(id: string, fn: () => Promise<{ ok: boolean; error?: string }>, success: string) {
    setBusy(id);
    setNotice(null);
    try {
      const result = await fn();
      setNotice(result.ok ? { kind: "ok", text: success } : { kind: "error", text: result.error ?? "Não foi possível concluir." });
      router.refresh();
      return result;
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <div className="topbar">
        <div>
          <h1>Agentes de IA</h1>
          <div className="sub">Chatbots que atendem seus clientes nas conversas, com a sua chave da Anthropic (Claude)</div>
        </div>
        <button className="btn primary" onClick={() => setForm({ agent: null })}>
          <Icon.plus /> Novo agente
        </button>
      </div>

      <div className="content">
        {notice && <p className={`ai-notice ${notice.kind}`} role="status">{notice.text}</p>}

        <section className="ai-intro">
          <div>
            <h2>Como funciona</h2>
            <ol>
              <li><strong>Crie um agente</strong>: escolha o modelo, cole sua chave e escreva as instruções da clínica.</li>
              <li><strong>Teste</strong> na própria tela, sem enviar nada a clientes.</li>
              <li><strong>Ligue a uma automação</strong>: gatilho “Mensagem recebida” → ação “Agente de IA”. O agente responde pelo mesmo canal (WhatsApp, Instagram ou e-mail).</li>
              <li>Quando o assunto é delicado ou o cliente pede uma pessoa, ele <strong>passa para a equipe</strong> e se cala naquela conversa até você clicar em “Retomar IA”.</li>
            </ol>
          </div>
          <div className="ai-intro-side">
            <strong>Prefere usar outra IA?</strong>
            <p>Agentes externos (n8n, Claude Desktop, GPT…) controlam o CRM pela <Link href="/mcp">Integração MCP</Link> ou pelo gatilho de webhook.</p>
            <p className="muted">As mensagens da conversa são enviadas à Anthropic para gerar a resposta. Informe isso na sua política de privacidade (LGPD).</p>
          </div>
        </section>

        {agents.length === 0 ? (
          <div className="empty-state">
            <Icon.zap />
            <div>Nenhum agente criado ainda. Crie o primeiro para atender seus clientes automaticamente.</div>
          </div>
        ) : (
          <div className="ai-grid">
            {agents.map((agent) => (
              <article key={agent.id} className="ai-card">
                <header>
                  <div>
                    <h3>{agent.name}</h3>
                    <span className="ai-meta">{modelLabel(agent.model)} · esforço {agent.effort} · chave ••••{agent.apiKeyHint}</span>
                  </div>
                  <span className={`pill ${agent.enabled ? "ai-on" : "ai-off"}`}>{agent.enabled ? "Ativo" : "Pausado"}</span>
                </header>

                <div className="ai-stats">
                  <div><strong>{agent.usage30d.replies}</strong><span>respostas (30 dias)</span></div>
                  <div><strong>{agent.usage30d.handoffs}</strong><span>passadas p/ equipe</span></div>
                  <div><strong>{fmtTokens(agent.usage30d.tokens)}</strong><span>tokens usados</span></div>
                  <div className={agent.usage30d.errors ? "bad" : ""}><strong>{agent.usage30d.errors}</strong><span>falhas</span></div>
                </div>

                {agent.lastError && <p className="ai-error" role="alert">⚠ {agent.lastError}</p>}

                <p className="ai-used">
                  {agent.usedBy.length > 0 ? (
                    <>Usado em: {agent.usedBy.join(", ")}</>
                  ) : (
                    <>
                      Ainda não está em nenhuma automação.{" "}
                      <button type="button" className="ai-link" disabled={busy === agent.id} onClick={async () => {
                        const result = await act(agent.id, () => createAiBotAutomation(agent.id), "Automação criada (desativada). Revise e ative em Automações.");
                        if (result?.ok && "automationId" in result) router.push(`/automations/${(result as { automationId: string }).automationId}`);
                      }}>Criar chatbot para mensagens recebidas</button>
                    </>
                  )}
                </p>

                <footer>
                  <button className="btn small primary" onClick={() => setTesting(agent)}>Testar conversa</button>
                  <button className="btn small" disabled={busy === agent.id} onClick={() => act(agent.id, () => checkAiAgentConnection(agent.id), "Chave e modelo conferidos: tudo certo.")}>Testar chave</button>
                  <button className="btn small" onClick={() => setForm({ agent })}>Editar</button>
                  <button className="btn small ghost danger" disabled={busy === agent.id} onClick={() => { if (confirm(`Excluir o agente “${agent.name}”?`)) void act(agent.id, () => deleteAiAgent(agent.id), "Agente excluído."); }}>Excluir</button>
                </footer>
              </article>
            ))}
          </div>
        )}
      </div>

      {form && <AgentForm agent={form.agent} onClose={() => setForm(null)} onSaved={() => { setForm(null); setNotice({ kind: "ok", text: "Agente salvo." }); router.refresh(); }} />}
      {testing && <Playground agent={testing} onClose={() => setTesting(null)} />}
    </>
  );
}

function AgentForm({ agent, onClose, onSaved }: { agent: AiAgentDTO | null; onClose: () => void; onSaved: () => void }) {
  const [value, setValue] = useState<AiAgentInput>(
    agent
      ? { id: agent.id, name: agent.name, enabled: agent.enabled, model: agent.model, effort: agent.effort, systemPrompt: agent.systemPrompt, apiKey: "", tools: agent.tools, maxToolSteps: agent.maxToolSteps, historyLimit: agent.historyLimit, replyLimitPerHour: agent.replyLimitPerHour, dailyTokenLimit: agent.dailyTokenLimit, handoffMessage: agent.handoffMessage }
      : EMPTY
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof AiAgentInput>(key: K, v: AiAgentInput[K]) => setValue((prev) => ({ ...prev, [key]: v }));
  const toggleTool = (name: AiToolName) => set("tools", value.tools.includes(name) ? value.tools.filter((t) => t !== name) : [...value.tools, name]);
  const model = AI_MODELS.find((m) => m.id === value.model);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const result = await saveAiAgent(value);
      if (result.ok) onSaved();
      else setError(result.error);
    } catch {
      setError("Não foi possível salvar. Tente novamente.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal wide ai-form" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>{agent ? "Editar agente" : "Novo agente de IA"}</h2>
          <button className="close-x" onClick={onClose} aria-label="Fechar"><Icon.close /></button>
        </div>
        <form onSubmit={submit}>
          <div className="modal-body">
            <div className="field-row">
              <div className="field">
                <label>Nome</label>
                <input value={value.name} onChange={(e) => set("name", e.target.value)} maxLength={80} required />
              </div>
              <div className="field ai-check">
                <label><input type="checkbox" checked={value.enabled} onChange={(e) => set("enabled", e.target.checked)} /> Agente ativo</label>
                <small className="field-help">Desmarque para pausar todas as respostas deste agente.</small>
              </div>
            </div>

            <div className="field-row">
              <div className="field">
                <label>Modelo</label>
                <select value={value.model} onChange={(e) => set("model", e.target.value)}>
                  {AI_MODELS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                </select>
                {model && <small className="field-help">{model.price}.</small>}
              </div>
              <div className="field">
                <label>Esforço de raciocínio</label>
                <select value={value.effort} onChange={(e) => set("effort", e.target.value)}>
                  {AI_EFFORTS.map((e) => <option key={e.id} value={e.id}>{e.label}</option>)}
                </select>
              </div>
            </div>

            <div className="field">
              <label>Chave de API da Anthropic {agent ? `(atual: ••••${agent.apiKeyHint})` : ""}</label>
              <input type="password" autoComplete="off" value={value.apiKey ?? ""} onChange={(e) => set("apiKey", e.target.value)} placeholder={agent ? "Deixe em branco para manter a chave atual" : "sk-ant-..."} required={!agent} />
              <small className="field-help">Crie em console.anthropic.com → API keys. Fica criptografada e nunca é exibida de novo. Use uma chave exclusiva deste CRM, com limite de gasto.</small>
            </div>

            <div className="field">
              <label>Instruções do agente</label>
              <textarea rows={11} value={value.systemPrompt} onChange={(e) => set("systemPrompt", e.target.value)} maxLength={8000} />
              <small className="field-help">Conte como a clínica funciona: endereço, horários, pagamento, tom de voz e quando chamar um humano. Regras de segurança já vêm embutidas.</small>
            </div>

            <div className="field">
              <label>O que o agente pode fazer</label>
              <div className="ai-tools">
                {AI_TOOLS.map((tool) => (
                  <label key={tool.name} className="ai-tool">
                    <input type="checkbox" checked={value.tools.includes(tool.name)} onChange={() => toggleTool(tool.name)} />
                    <span>
                      <strong>{tool.label}</strong>{tool.writes && <em>altera dados</em>}
                      <small>{tool.description}</small>
                    </span>
                  </label>
                ))}
              </div>
              <small className="field-help">“Passar para um atendente humano” está sempre ligado. Ele só enxerga e altera os dados do cliente da conversa.</small>
            </div>

            <div className="field-row">
              <div className="field">
                <label>Respostas por hora (por cliente)</label>
                <input type="number" min={1} max={200} value={value.replyLimitPerHour} onChange={(e) => set("replyLimitPerHour", Number(e.target.value))} />
                <small className="field-help">Acima disso, passa para a equipe (evita laço entre robôs).</small>
              </div>
              <div className="field">
                <label>Limite diário de tokens (0 = sem limite)</label>
                <input type="number" min={0} step={10000} value={value.dailyTokenLimit} onChange={(e) => set("dailyTokenLimit", Number(e.target.value))} />
                <small className="field-help">Teto de gasto por dia para este agente.</small>
              </div>
            </div>
            <div className="field-row">
              <div className="field">
                <label>Mensagens lembradas</label>
                <input type="number" min={4} max={40} value={value.historyLimit} onChange={(e) => set("historyLimit", Number(e.target.value))} />
              </div>
              <div className="field">
                <label>Passos por resposta (máx.)</label>
                <input type="number" min={1} max={10} value={value.maxToolSteps} onChange={(e) => set("maxToolSteps", Number(e.target.value))} />
              </div>
            </div>
            <div className="field">
              <label>Mensagem ao passar para a equipe</label>
              <textarea rows={2} value={value.handoffMessage} onChange={(e) => set("handoffMessage", e.target.value)} maxLength={500} />
            </div>
            {error && <p className="form-error" role="alert">{error}</p>}
          </div>
          <div className="modal-foot">
            <button type="button" className="btn" onClick={onClose}>Cancelar</button>
            <button type="submit" className="btn primary" disabled={saving}>{saving ? "Salvando…" : "Salvar agente"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

type ChatLine = { role: "user" | "assistant"; content: string; trace?: { tool: string; result: string; isError: boolean }[]; note?: string };

function Playground({ agent, onClose }: { agent: AiAgentDTO; onClose: () => void }) {
  const [lines, setLines] = useState<ChatLine[]>([]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  async function send(event: React.FormEvent) {
    event.preventDefault();
    const message = text.trim();
    if (!message || sending) return;
    const next: ChatLine[] = [...lines, { role: "user", content: message }];
    setLines(next);
    setText("");
    setSending(true);
    setError(null);
    try {
      const result = await chatWithAiAgent(agent.id, next.map((l) => ({ role: l.role, content: l.content })));
      if (!result.ok) {
        setError(result.error);
      } else {
        setLines([...next, { role: "assistant", content: result.reply || "(sem resposta)", trace: result.trace, note: result.handoffReason ? `Passou para a equipe: ${result.handoffReason}` : result.outcome !== "replied" && !result.handoffReason ? `Desfecho: ${result.outcome}` : undefined }]);
      }
    } catch {
      setError("Não foi possível testar agora.");
    } finally {
      setSending(false);
      setTimeout(() => endRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal ai-playground" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <h2>Testar “{agent.name}”</h2>
            <small className="muted">Você fala como cliente. Nada é enviado e nada é gravado na agenda ou na ficha.</small>
          </div>
          <button className="close-x" onClick={onClose} aria-label="Fechar"><Icon.close /></button>
        </div>
        <div className="ai-chat">
          {lines.length === 0 && <p className="muted">Experimente: “Quanto custa a limpeza de pele?” ou “Quero marcar para sexta”.</p>}
          {lines.map((line, i) => (
            <div key={i} className={`ai-line ${line.role}`}>
              <div className="ai-bubble">{line.content}</div>
              {line.trace && line.trace.length > 0 && (
                <details className="ai-trace">
                  <summary>{line.trace.length} ferramenta(s) usada(s)</summary>
                  {line.trace.map((t, j) => <div key={j} className={t.isError ? "bad" : ""}><code>{t.tool}</code> {t.result}</div>)}
                </details>
              )}
              {line.note && <small className="ai-note">{line.note}</small>}
            </div>
          ))}
          {sending && <div className="ai-line assistant"><div className="ai-bubble muted">Pensando…</div></div>}
          {error && <p className="form-error" role="alert">{error}</p>}
          <div ref={endRef} />
        </div>
        <form className="ai-chat-input" onSubmit={send}>
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Escreva como o cliente…" autoFocus maxLength={2000} />
          <button className="btn primary" disabled={sending || !text.trim()}>Enviar</button>
        </form>
      </div>
    </div>
  );
}
