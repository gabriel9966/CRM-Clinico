"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icons";
import { ReconnectDialog } from "./ReconnectDialog";
import { useBrowserOrigin } from "@/lib/use-browser-origin";
import type { ConnectionDTO } from "@/lib/types";
import {
  createWhatsAppConnection,
  createInstagramConnection,
  createEmailConnection,
  createAzapConnection,
  createWhatsAppCloudConnection,
  checkWhatsAppStatus,
  refreshWhatsAppQr,
  getConnectionWebhookUrl,
  refreshWhatsAppWebhook,
  deleteConnection,
  type CreateWhatsAppState,
  type CreateInstagramState,
  type CreateEmailState,
} from "@/app/connections/actions";
import { createInboundWebhook, deleteInboundWebhook, toggleInboundWebhook, type InboundWebhookInput } from "@/app/inbound-webhooks/actions";

const PROVIDER_LABEL: Record<ConnectionDTO["provider"], string> = {
  WHATSAPP_EVOLUTION: "WhatsApp",
  WHATSAPP_AZAP: "WhatsApp · AZAP",
  WHATSAPP_CLOUD: "WhatsApp · Cloud API",
  INSTAGRAM: "Instagram",
  EMAIL: "E-mail",
};

const STATUS_LABEL: Record<ConnectionDTO["status"], string> = {
  CONNECTED: "Conectado",
  CONNECTING: "Conectando",
  DISCONNECTED: "Desconectado",
  ERROR: "Erro",
};

const STATUS_COLOR: Record<ConnectionDTO["status"], string> = {
  CONNECTED: "var(--green)",
  CONNECTING: "var(--orange)",
  DISCONNECTED: "var(--text-faint)",
  ERROR: "var(--red)",
};

type InboundItem = { id: string; name: string; enabled: boolean; mapping: string; createdAt: string };
type WebhookItem = { id: string; source: string; event: string | null; statusCode: number; detail: string | null; createdAt: string; connectionId: string | null };

export function ConnectionsView({ connections, inboundWebhooks, webhookLogs }: { connections: ConnectionDTO[]; inboundWebhooks: InboundItem[]; webhookLogs: WebhookItem[] }) {
  const router = useRouter();
  const [modal, setModal] = useState<null | "choose" | "whatsapp" | "azap" | "cloud" | "instagram" | "email" | "inbound">(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [reconnectId, setReconnectId] = useState<string | null>(null);

  async function handleDelete(id: string) {
    if (!confirm("Desconectar e remover esta conexão?")) return;
    setBusyId(id);
    try {
      await deleteConnection(id);
      router.refresh();
    } finally {
      setBusyId(null);
    }
  }

  async function handleCheckStatus(id: string) {
    setBusyId(id);
    try {
      await checkWhatsAppStatus(id);
      router.refresh();
    } finally {
      setBusyId(null);
    }
  }

  async function handleCopyWebhook(id: string) {
    setBusyId(id);
    try {
      const res = await getConnectionWebhookUrl(id);
      if (!res.url) return alert(res.error ?? "Não foi possível obter a URL.");
      const url = res.url.startsWith("/") ? `${window.location.origin}${res.url}` : res.url;
      try {
        await navigator.clipboard.writeText(url);
        alert("URL do webhook copiada.");
      } catch {
        prompt("Copie a URL do webhook:", url);
      }
    } finally {
      setBusyId(null);
    }
  }

  async function handleRefreshWebhook(id: string) {
    if (!confirm("Usar o webhook do CRM nesta instância? Isso substitui o webhook anterior configurado no provedor.")) return;
    setBusyId(id);
    try {
      const res = await refreshWhatsAppWebhook(id);
      alert(res.ok ? "Webhook atualizado na instância (agora com token de segurança)." : res.error ?? "Falha ao atualizar.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
      <div className="topbar">
        <div>
          <h1>Conexões</h1>
          <div className="sub">Conecte o WhatsApp ou Instagram que você mesmo usa</div>
        </div>
        <button className="btn primary" onClick={() => setModal("choose")}>
          <Icon.plus /> Nova conexão
        </button>
      </div>

      <div className="content">
        {connections.length === 0 ? (
          <div className="empty-state">
            <Icon.plug />
            <div>Nenhuma conexão ainda. Conecte seu WhatsApp ou Instagram para receber e enviar mensagens reais por aqui.</div>
            <button className="btn primary small" style={{ marginTop: 10 }} onClick={() => setModal("choose")}>
              Nova conexão
            </button>
          </div>
        ) : (
          <div className="connection-grid">
            {connections.map((c) => (
              <article key={c.id} className="connection-card">
                <div className="connection-card-head"><div><span className="connection-provider">{PROVIDER_LABEL[c.provider]}</span><h3>{c.label}</h3></div>
                  <span className="pill" style={{ background: STATUS_COLOR[c.status] + "22", color: STATUS_COLOR[c.status] }}>{STATUS_LABEL[c.status]}</span></div>
                <div className="connection-card-meta">Instância/conexão ativa para atendimento multicanal · criada em {new Date(c.createdAt).toLocaleDateString("pt-BR")}</div>
                {c.status === "ERROR" && c.lastError && <div className="connection-error">{c.lastError}</div>}
                <div className="connection-card-actions">
                      {c.provider === "WHATSAPP_EVOLUTION" && c.status !== "CONNECTED" && <button type="button" className="btn small primary" onClick={() => setReconnectId(c.id)}>Reconectar / QR Code</button>}
                      {["WHATSAPP_EVOLUTION", "WHATSAPP_AZAP", "WHATSAPP_CLOUD"].includes(c.provider) && (
                        <button className="btn small" disabled={busyId === c.id} onClick={() => handleCheckStatus(c.id)}>
                          Verificar conexão
                        </button>
                      )}
                      {c.provider !== "INSTAGRAM" && (
                        <>
                          {" "}
                          <button className="btn small" disabled={busyId === c.id} onClick={() => handleCopyWebhook(c.id)}>
                            Copiar webhook
                          </button>
                        </>
                      )}
                      {c.provider === "WHATSAPP_EVOLUTION" && (
                        <>
                          {" "}
                          <button className="btn small" disabled={busyId === c.id} onClick={() => handleRefreshWebhook(c.id)}>
                            Atualizar webhook
                          </button>
                        </>
                      )}
                      {" "}
                      <button className="btn small danger" disabled={busyId === c.id} onClick={() => handleDelete(c.id)}>
                        <Icon.trash />
                      </button>
                </div>
              </article>
            ))}
          </div>
        )}

        {/* Dentro do .content para herdar o mesmo recuo lateral da página. */}
        <section className="connections-operations">
          <div className="section-heading"><div><h2>Entradas por formulário e webhook</h2><p>Crie leads a partir de formulários, landing pages e outras ferramentas com mapeamento de campos.</p></div><button className="btn primary small" onClick={() => setModal("inbound")}>Criar entrada</button></div>
          {inboundWebhooks.length === 0 ? <div className="muted">Nenhuma entrada configurada.</div> : <div className="inbound-list">{inboundWebhooks.map((item) => <div className="inbound-row" key={item.id}><div><strong>{item.name}</strong><span>{item.enabled ? "Ativa" : "Pausada"}</span></div><div><button className="btn small" onClick={() => toggleInboundWebhook(item.id, !item.enabled).then(() => router.refresh())}>{item.enabled ? "Pausar" : "Ativar"}</button><button className="btn small danger" onClick={() => deleteInboundWebhook(item.id).then(() => router.refresh())}><Icon.trash /></button></div></div>)}</div>}
        </section>
        <section className="connections-operations"><div className="section-heading"><div><h2>Logs de webhook</h2><p>Últimos eventos recebidos de suas instâncias e integrações.</p></div></div><div className="webhook-log-list">{webhookLogs.length === 0 ? <span className="muted">Nenhum evento recebido ainda.</span> : webhookLogs.map((log) => <div className="webhook-log" key={log.id}><span className={log.statusCode >= 400 ? "error" : "ok"}>{log.statusCode}</span><strong>{log.source}</strong><span>{log.event || "evento"}</span><small>{log.detail || "Processado"} · {new Date(log.createdAt).toLocaleString("pt-BR")}</small></div>)}</div></section>
      </div>

      {reconnectId && <ReconnectDialog id={reconnectId} onClose={() => setReconnectId(null)} />}
      {modal === "choose" && (
        <div className="modal-overlay" onClick={() => setModal(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h2>Nova conexão</h2>
              <button className="close-x" onClick={() => setModal(null)}><Icon.close /></button>
            </div>
            <div className="modal-body" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <button className="btn" style={{ justifyContent: "flex-start", padding: 14 }} onClick={() => setModal("whatsapp")}>
                <strong>WhatsApp</strong>&nbsp;<span className="muted">— via sua instância Evolution API</span>
              </button>
              <button className="btn" style={{ justifyContent: "flex-start", padding: 14 }} onClick={() => setModal("azap")}><strong>WhatsApp via AZAP</strong>&nbsp;<span className="muted">— endpoint da sua conta AZAP</span></button>
              <button className="btn" style={{ justifyContent: "flex-start", padding: 14 }} onClick={() => setModal("cloud")}><strong>WhatsApp Cloud API</strong>&nbsp;<span className="muted">— API oficial da Meta</span></button>
              <button className="btn" style={{ justifyContent: "flex-start", padding: 14 }} onClick={() => setModal("instagram")}>
                <strong>Instagram</strong>&nbsp;<span className="muted">— via seu App da Meta</span>
              </button>
              <button className="btn" style={{ justifyContent: "flex-start", padding: 14 }} onClick={() => setModal("email")}>
                <strong>E-mail</strong>&nbsp;<span className="muted">— via sua conta Resend</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {modal === "whatsapp" && <WhatsAppModal onClose={() => setModal(null)} />}
      {modal === "instagram" && <InstagramModal onClose={() => setModal(null)} />}
      {modal === "email" && <EmailModal onClose={() => setModal(null)} />}
      {modal === "azap" && <AzapModal onClose={() => setModal(null)} />}
      {modal === "cloud" && <CloudModal onClose={() => setModal(null)} />}
      {modal === "inbound" && <InboundModal onClose={() => setModal(null)} />}
    </>
  );
}

const whatsAppInitial: CreateWhatsAppState = {};

function WhatsAppModal({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(createWhatsAppConnection, whatsAppInitial);
  const [refreshedQr, setQrcode] = useState<string | null>(null);
  const qrcode = refreshedQr || state.qrcode;
  const connectionId = state.connectionId;
  const [checking, setChecking] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (state.connectionId && !state.qrcode && !state.error) {
      router.refresh(); onClose();
    }
  }, [state, router, onClose]);

  useEffect(() => {
    if (!connectionId) return;
    let running = false;
    pollRef.current = setInterval(async () => {
      if (running) return;
      running = true;
      setChecking(true);
      try {
        const res = await checkWhatsAppStatus(connectionId);
        if (res.status === "CONNECTED") {
        if (pollRef.current) clearInterval(pollRef.current);
        router.refresh();
        onClose();
        }
      } catch {
        // A conexão pode estar reiniciando; a próxima consulta tenta novamente.
      } finally {
        setChecking(false); running = false;
      }
    }, 4000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectionId]);

  async function handleRefreshQr() {
    if (!connectionId) return;
    const res = await refreshWhatsAppQr(connectionId);
    if (res.qrcode) setQrcode(res.qrcode);
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Conectar WhatsApp</h2>
          <button className="close-x" onClick={onClose}><Icon.close /></button>
        </div>

        {!qrcode ? (
          <form action={formAction}>
            <div className="modal-body">
              <div className="field"><label>Versão do servidor</label><select name="variant"><option value="v2">Evolution API v2</option><option value="go">Evolution GO</option></select></div>
              <div className="field"><label>Tipo de conexão</label><select name="mode"><option value="new">Criar uma instância exclusiva para o CRM</option><option value="existing">Vincular instância Evolution GO existente</option></select><small className="muted">Ao vincular, informe o token da instância. O webhook existente será preservado; use Atualizar webhook quando quiser direcionar os eventos ao CRM.</small></div>
              <div className="field">
                <label>Nome da conexão *</label>
                <input name="label" required placeholder="Ex: WhatsApp Vendas" autoFocus />
              </div>
              <div className="field">
                <label>URL da sua Evolution API *</label>
                <input name="baseUrl" required placeholder="https://evolution.seudominio.com" />
              </div>
              <div className="field">
                <label>Chave de acesso *</label>
                <input name="apiKey" type="password" required placeholder="Global para criar; token da instância para vincular" />
              </div>
              <div className="field">
                <label>Nome da instância *</label>
                <input name="instanceName" required placeholder="ex: vendas-principal" />
              </div>
              {state.error && (
                <p style={{ color: "var(--red)", fontSize: 13, fontWeight: 600 }}>{state.error}</p>
              )}
            </div>
            <div className="modal-foot">
              <button type="button" className="btn" onClick={onClose}>Cancelar</button>
              <button type="submit" className="btn primary" disabled={pending}>
                {pending ? "Conectando..." : "Salvar conexão"}
              </button>
            </div>
          </form>
        ) : (
          <>
            <div className="modal-body" style={{ textAlign: "center" }}>
              <p style={{ fontSize: 13, color: "var(--text-soft)", marginBottom: 14 }}>
                Abra o WhatsApp no celular → Configurações → Aparelhos conectados → Conectar um aparelho, e escaneie o código abaixo.
              </p>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={qrcode} alt="QR code do WhatsApp" style={{ width: 240, height: 240, margin: "0 auto", borderRadius: 8, border: "1px solid var(--border)" }} />
              <p style={{ fontSize: 12, color: "var(--text-faint)", marginTop: 12 }}>
                {checking ? "Verificando conexão..." : "Aguardando leitura do QR code..."}
              </p>
              <button type="button" className="btn small" style={{ marginTop: 8 }} onClick={handleRefreshQr}>
                Gerar novo QR code
              </button>
            </div>
            <div className="modal-foot">
              <button type="button" className="btn" onClick={onClose}>Fechar</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

const instagramInitial: CreateInstagramState = {};

function InstagramModal({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(createInstagramConnection, instagramInitial);
  const wasPending = useRef(false);
  const webhookUrl = `${useBrowserOrigin()}/api/webhooks/instagram`;

  useEffect(() => {
    if (wasPending.current && !pending && !state.error) {
      router.refresh();
      onClose();
    }
    wasPending.current = pending;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending, state]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Conectar Instagram</h2>
          <button className="close-x" onClick={onClose}><Icon.close /></button>
        </div>
        <form action={formAction}>
          <div className="modal-body">
            <p style={{ fontSize: 12, color: "var(--text-faint)", marginBottom: 14 }}>
              Requer um App seu no Meta for Developers com a permissão <code>instagram_manage_messages</code> aprovada,
              e uma conta Instagram profissional conectada a uma Página do Facebook.
            </p>
            <div className="field">
              <label>Nome da conexão *</label>
              <input name="label" required placeholder="Ex: Instagram Comercial" autoFocus />
            </div>
            <div className="field">
              <label>Access token *</label>
              <input name="accessToken" type="password" required placeholder="token de longa duração da Página" />
            </div>
            <div className="field">
              <label>ID da conta do Instagram *</label>
              <input name="igUserId" required placeholder="IGSID da conta profissional" />
            </div>
            <div className="field">
              <label>URL de webhook (cole no painel da Meta)</label>
              <input readOnly value={webhookUrl} onFocus={(e) => e.target.select()} />
            </div>
            {state.error && (
              <p style={{ color: "var(--red)", fontSize: 13, fontWeight: 600 }}>{state.error}</p>
            )}
          </div>
          <div className="modal-foot">
            <button type="button" className="btn" onClick={onClose}>Cancelar</button>
            <button type="submit" className="btn primary" disabled={pending}>
              {pending ? "Validando..." : "Conectar"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

const emailInitial: CreateEmailState = {};

function EmailModal({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(createEmailConnection, emailInitial);
  const wasPending = useRef(false);
  const webhookUrl = `${useBrowserOrigin()}/api/webhooks/email/<connectionId>?token=<token> (use "Copiar webhook" na lista)`;

  useEffect(() => {
    if (wasPending.current && !pending && !state.error) {
      router.refresh();
      onClose();
    }
    wasPending.current = pending;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending, state]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Conectar e-mail</h2>
          <button className="close-x" onClick={onClose}><Icon.close /></button>
        </div>
        <form action={formAction}>
          <div className="modal-body">
            <p style={{ fontSize: 12, color: "var(--text-faint)", marginBottom: 14 }}>
              Requer uma conta Resend com um domínio verificado. A API key é usada só para enviar e-mails;
              para receber respostas, configure o inbound do Resend apontando pra URL de webhook abaixo
              (o id da conexão real aparece depois de salvar).
            </p>
            <div className="field">
              <label>Nome da conexão *</label>
              <input name="label" required placeholder="Ex: Suporte por e-mail" autoFocus />
            </div>
            <div className="field">
              <label>API key da Resend *</label>
              <input name="apiKey" type="password" required placeholder="re_..." />
            </div>
            <div className="field-row">
              <div className="field">
                <label>E-mail de envio *</label>
                <input name="fromAddress" type="email" required placeholder="contato@seudominio.com" />
              </div>
              <div className="field">
                <label>Nome de exibição</label>
                <input name="fromName" placeholder="Ex: Equipe Comercial" />
              </div>
            </div>
            <div className="field">
              <label>URL de webhook (padrão, cole no inbound da Resend)</label>
              <input readOnly value={webhookUrl} onFocus={(e) => e.target.select()} />
            </div>
            {state.error && (
              <p style={{ color: "var(--red)", fontSize: 13, fontWeight: 600 }}>{state.error}</p>
            )}
          </div>
          <div className="modal-foot">
            <button type="button" className="btn" onClick={onClose}>Cancelar</button>
            <button type="submit" className="btn primary" disabled={pending}>
              {pending ? "Validando..." : "Conectar"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function AzapModal({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(createAzapConnection, {});
  const wasPending = useRef(false);
  useEffect(() => { if (wasPending.current && !pending && !state.error) { router.refresh(); onClose(); } wasPending.current = pending; }, [pending, state, router, onClose]);
  return <div className="modal-overlay" onClick={onClose}><div className="modal" onClick={(event) => event.stopPropagation()}><div className="modal-head"><h2>Conectar AZAP</h2><button className="close-x" onClick={onClose}><Icon.close /></button></div><form action={formAction}><div className="modal-body"><p className="muted">Informe a URL de envio indicada pela documentação da sua conta AZAP. O CRM envia o número, texto e nome da instância no payload.</p><div className="field"><label>Nome da conexão *</label><input name="label" required placeholder="Ex: WhatsApp SDR" autoFocus /></div><div className="field"><label>URL HTTPS de envio *</label><input name="sendUrl" type="url" required placeholder="https://api.seuprovedor.com/..." /></div><div className="field"><label>Chave da API *</label><input name="apiKey" type="password" required /></div><div className="field"><label>Nome/ID da instância</label><input name="instanceName" placeholder="Opcional" /></div>{state.error && <p className="form-error">{state.error}</p>}</div><div className="modal-foot"><button type="button" className="btn" onClick={onClose}>Cancelar</button><button className="btn primary" disabled={pending}>{pending ? "Validando..." : "Conectar"}</button></div></form></div></div>;
}

function CloudModal({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(createWhatsAppCloudConnection, {});
  const url = `${useBrowserOrigin()}/api/webhooks/whatsapp-cloud`;
  const wasPending = useRef(false);
  useEffect(() => { if (wasPending.current && !pending && !state.error) { router.refresh(); onClose(); } wasPending.current = pending; }, [pending, state, router, onClose]);
  return <div className="modal-overlay" onClick={onClose}><div className="modal" onClick={(event) => event.stopPropagation()}><div className="modal-head"><h2>WhatsApp Cloud API oficial</h2><button className="close-x" onClick={onClose}><Icon.close /></button></div><form action={formAction}><div className="modal-body"><p className="muted">Use um token de sistema da Meta com permissão de mensagens. Cadastre a URL abaixo no webhook do App e assine o campo <code>messages</code>.</p><div className="field"><label>Nome da conexão *</label><input name="label" required placeholder="Ex: WhatsApp Oficial" autoFocus /></div><div className="field"><label>Access token *</label><input name="accessToken" type="password" required /></div><div className="field"><label>Phone Number ID *</label><input name="phoneNumberId" required /></div><div className="field-row"><div className="field"><label>Versão Graph API</label><input name="apiVersion" defaultValue="v23.0" /></div><div className="field"><label>Token de verificação *</label><input name="verifyToken" type="password" required /></div></div><div className="field"><label>URL de webhook</label><input readOnly value={url} onFocus={(event) => event.target.select()} /></div>{state.error && <p className="form-error">{state.error}</p>}</div><div className="modal-foot"><button type="button" className="btn" onClick={onClose}>Cancelar</button><button className="btn primary" disabled={pending}>{pending ? "Validando..." : "Conectar"}</button></div></form></div></div>;
}

function InboundModal({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ url?: string; error?: string }>({});
  return <div className="modal-overlay" onClick={onClose}><div className="modal" onClick={(event) => event.stopPropagation()}><div className="modal-head"><h2>Entrada de formulário</h2><button className="close-x" onClick={onClose}><Icon.close /></button></div><form onSubmit={async (event) => { event.preventDefault(); setBusy(true); const data = new FormData(event.currentTarget); const response = await createInboundWebhook({ name: String(data.get("name") || ""), namePath: String(data.get("namePath") || ""), phonePath: String(data.get("phonePath") || ""), emailPath: String(data.get("emailPath") || ""), companyPath: String(data.get("companyPath") || ""), tagsPath: String(data.get("tagsPath") || "") } satisfies InboundWebhookInput); setResult(response); setBusy(false); if (response.id) router.refresh(); }}><div className="modal-body"><p className="muted">Informe caminhos do JSON, por exemplo <code>data.name</code> ou <code>contact.phone</code>. Campos vazios são ignorados.</p><div className="field"><label>Nome da entrada *</label><input name="name" required placeholder="Formulário do site" autoFocus /></div><div className="field-row"><div className="field"><label>Campo nome</label><input name="namePath" defaultValue="name" /></div><div className="field"><label>Campo telefone</label><input name="phonePath" defaultValue="phone" /></div></div><div className="field-row"><div className="field"><label>Campo e-mail</label><input name="emailPath" defaultValue="email" /></div><div className="field"><label>Campo empresa</label><input name="companyPath" defaultValue="company" /></div></div><div className="field"><label>Campo tags</label><input name="tagsPath" defaultValue="tags" /></div>{result.url && <div className="field"><label>URL gerada</label><input readOnly value={result.url} onFocus={(event) => event.target.select()} /></div>}{result.error && <p className="form-error">{result.error}</p>}</div><div className="modal-foot"><button type="button" className="btn" onClick={onClose}>Fechar</button><button className="btn primary" disabled={busy}>{busy ? "Criando..." : "Criar entrada"}</button></div></form></div></div>;
}
