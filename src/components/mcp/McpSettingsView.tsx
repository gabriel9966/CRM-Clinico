"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/components/icons";
import { regenerateKey } from "@/app/mcp/actions";

const TOOLS = [
  { name: "list_contacts", desc: "Lista contatos (com busca opcional)" },
  { name: "get_contact", desc: "Detalha um contato, com oportunidades e mensagens recentes" },
  { name: "create_contact", desc: "Cria um novo contato" },
  { name: "list_pipelines", desc: "Lista os pipelines e suas etapas" },
  { name: "list_opportunities", desc: "Lista oportunidades, com filtros" },
  { name: "create_opportunity", desc: "Cria uma oportunidade" },
  { name: "move_opportunity_stage", desc: "Move uma oportunidade de etapa" },
  { name: "list_team", desc: "Lista os membros da equipe" },
  { name: "send_message", desc: "Envia uma mensagem a um contato (WhatsApp/Instagram se conectado)" },
];

const REST_ENDPOINTS = [
  { method: "GET", path: "/api/v1/contacts?search=" },
  { method: "POST", path: "/api/v1/contacts" },
  { method: "GET", path: "/api/v1/contacts/:id" },
  { method: "PATCH", path: "/api/v1/contacts/:id" },
  { method: "DELETE", path: "/api/v1/contacts/:id" },
  { method: "GET", path: "/api/v1/opportunities?pipelineId=&stageId=&contactId=" },
  { method: "POST", path: "/api/v1/opportunities" },
  { method: "PATCH", path: "/api/v1/opportunities/:id" },
  { method: "DELETE", path: "/api/v1/opportunities/:id" },
  { method: "GET", path: "/api/v1/pipelines" },
  { method: "GET", path: "/api/v1/activities?contactId=&done=" },
  { method: "POST", path: "/api/v1/activities" },
  { method: "PATCH", path: "/api/v1/activities/:id" },
  { method: "DELETE", path: "/api/v1/activities/:id" },
  { method: "GET", path: "/api/v1/appointments?contactId=" },
  { method: "POST", path: "/api/v1/appointments" },
  { method: "GET", path: "/api/v1/team" },
  { method: "POST", path: "/api/v1/messages" },
];

function CopyField({ label, value, secret }: { label: string; value: string; secret?: boolean }) {
  const [revealed, setRevealed] = useState(!secret);
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard pode falhar em contexto não seguro; o campo continua selecionável manualmente
    }
  }

  return (
    <div className="field">
      <label>{label}</label>
      <div style={{ display: "flex", gap: 6 }}>
        <input
          readOnly
          value={revealed ? value : "•".repeat(Math.min(value.length, 40))}
          onFocus={(e) => e.target.select()}
          style={{ fontFamily: "monospace", fontSize: 12.5 }}
        />
        {secret && (
          <button type="button" className="btn small" onClick={() => setRevealed((r) => !r)}>
            {revealed ? "Ocultar" : "Mostrar"}
          </button>
        )}
        <button type="button" className="btn small" onClick={copy}>
          <Icon.copy /> {copied ? "Copiado!" : "Copiar"}
        </button>
      </div>
    </div>
  );
}

export function McpSettingsView({ apiKey: initialApiKey }: { apiKey: string }) {
  const [apiKey, setApiKey] = useState(initialApiKey);
  const [mcpUrl, setMcpUrl] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setMcpUrl(`${window.location.origin}/api/mcp`);
  }, []);

  async function handleRegenerate() {
    if (!confirm("Gerar uma nova chave invalida a atual imediatamente — qualquer integração usando a chave antiga vai parar de funcionar até você atualizar lá também. Continuar?")) return;
    setBusy(true);
    try {
      const newKey = await regenerateKey();
      setApiKey(newKey);
    } finally {
      setBusy(false);
    }
  }

  // Os exemplos abaixo nunca mostram a chave real em texto puro (mesmo que o
  // campo "Chave de API" esteja oculto) — evita vazar o segredo em prints de
  // tela ou compartilhamento acidental da página.
  const cliCommand = `claude mcp add --transport http novacrm ${mcpUrl} --header "Authorization: Bearer SUA_CHAVE_AQUI"`;
  const apiBase = mcpUrl.replace("/api/mcp", "/api/v1");
  const curlExample = `curl ${apiBase}/contacts \\\n  -H "Authorization: Bearer SUA_CHAVE_AQUI"`;

  return (
    <>
      <div className="topbar">
        <div>
          <h1>Integração &amp; API</h1>
          <div className="sub">Conecte o CRM a Claude, n8n, Zapier ou qualquer sistema externo</div>
        </div>
      </div>

      <div className="content" style={{ maxWidth: 720 }}>
        <div className="chart-card" style={{ marginBottom: 16 }}>
          <div className="chart-title">Credenciais</div>
          <div className="chart-sub">A mesma chave vale para o MCP e para a API REST abaixo</div>

          <CopyField label="Chave de API (Authorization: Bearer ...)" value={apiKey} secret />

          <button className="btn danger small" onClick={handleRegenerate} disabled={busy}>
            {busy ? "Gerando..." : "Gerar nova chave"}
          </button>
        </div>

        <div className="chart-card" style={{ marginBottom: 16 }}>
          <div className="chart-title">API REST</div>
          <div className="chart-sub">
            Para automações externas (n8n, Zapier, scripts) — JSON, autenticado via header Bearer, isolado por empresa.
          </div>

          <CopyField label="URL base" value={apiBase} />

          <div className="field">
            <label>Exemplo (curl) — troque SUA_CHAVE_AQUI pela chave acima</label>
            <textarea readOnly value={curlExample} className="code-textarea" style={{ minHeight: 60 }} onFocus={(e) => e.target.select()} />
          </div>

          <div className="table-wrap" style={{ boxShadow: "none" }}>
            <table>
              <thead><tr><th style={{ width: 70 }}>Método</th><th>Rota</th></tr></thead>
              <tbody>
                {REST_ENDPOINTS.map((e) => (
                  <tr key={e.method + e.path} className="row" style={{ cursor: "default" }}>
                    <td>
                      <span
                        className="pill"
                        style={{
                          background: e.method === "GET" ? "var(--blue-soft)" : e.method === "POST" ? "var(--green-soft)" : e.method === "PATCH" ? "var(--orange-soft)" : "var(--red-soft)",
                          color: e.method === "GET" ? "var(--blue)" : e.method === "POST" ? "var(--green)" : e.method === "PATCH" ? "var(--orange)" : "var(--red)",
                        }}
                      >
                        {e.method}
                      </span>
                    </td>
                    <td style={{ fontFamily: "monospace", fontSize: 12.5 }}>{e.path}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="chart-card" style={{ marginBottom: 16 }}>
          <div className="chart-title">Servidor MCP</div>
          <div className="chart-sub">Para agentes de IA (Claude Code, Claude Desktop, etc.)</div>

          <CopyField label="URL do servidor MCP" value={mcpUrl} />

          <div className="field">
            <label>Comando pronto (Claude Code)</label>
            <textarea readOnly value={cliCommand} className="code-textarea" style={{ minHeight: 50 }} onFocus={(e) => e.target.select()} />
          </div>
        </div>

        <div className="chart-card">
          <div className="chart-title">Ferramentas MCP disponíveis</div>
          <div className="chart-sub">O que um agente conectado consegue fazer no CRM agora</div>
          <div className="table-wrap" style={{ boxShadow: "none" }}>
            <table>
              <thead><tr><th>Ferramenta</th><th>O que faz</th></tr></thead>
              <tbody>
                {TOOLS.map((t) => (
                  <tr key={t.name} className="row" style={{ cursor: "default" }}>
                    <td style={{ fontFamily: "monospace", fontWeight: 700, fontSize: 12.5 }}>{t.name}</td>
                    <td className="muted">{t.desc}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </>
  );
}
