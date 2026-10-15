"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icons";
import type { ConnectionDTO } from "@/lib/types";
import {
  createWhatsAppConnection,
  createInstagramConnection,
  createEmailConnection,
  checkWhatsAppStatus,
  refreshWhatsAppQr,
  getConnectionWebhookUrl,
  refreshWhatsAppWebhook,
  deleteConnection,
  type CreateWhatsAppState,
  type CreateInstagramState,
  type CreateEmailState,
} from "@/app/connections/actions";

const PROVIDER_LABEL: Record<ConnectionDTO["provider"], string> = {
  WHATSAPP_EVOLUTION: "WhatsApp",
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

export function ConnectionsView({ connections }: { connections: ConnectionDTO[] }) {
  const router = useRouter();
  const [modal, setModal] = useState<null | "choose" | "whatsapp" | "instagram" | "email">(null);
  const [busyId, setBusyId] = useState<string | null>(null);

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
      try {
        await navigator.clipboard.writeText(res.url);
        alert("URL do webhook copiada.");
      } catch {
        prompt("Copie a URL do webhook:", res.url);
      }
    } finally {
      setBusyId(null);
    }
  }

  async function handleRefreshWebhook(id: string) {
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
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Canal</th><th>Nome</th><th>Status</th><th>Criada em</th><th></th></tr>
              </thead>
              <tbody>
                {connections.map((c) => (
                  <tr key={c.id} className="row">
                    <td>{PROVIDER_LABEL[c.provider]}</td>
                    <td style={{ fontWeight: 700 }}>{c.label}</td>
                    <td>
                      <span className="pill" style={{ background: STATUS_COLOR[c.status] + "22", color: STATUS_COLOR[c.status] }}>
                        {STATUS_LABEL[c.status]}
                      </span>
                      {c.status === "ERROR" && c.lastError && (
                        <div className="muted" style={{ fontSize: 11, marginTop: 3, maxWidth: 260 }}>{c.lastError}</div>
                      )}
                    </td>
                    <td className="muted">{new Date(c.createdAt).toLocaleDateString("pt-BR")}</td>
                    <td style={{ textAlign: "right" }}>
                      {c.provider === "WHATSAPP_EVOLUTION" && c.status !== "CONNECTED" && (
                        <button className="btn small" disabled={busyId === c.id} onClick={() => handleCheckStatus(c.id)}>
                          Checar status
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
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

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
    </>
  );
}

const whatsAppInitial: CreateWhatsAppState = {};

function WhatsAppModal({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(createWhatsAppConnection, whatsAppInitial);
  const [qrcode, setQrcode] = useState<string | null>(null);
  const [connectionId, setConnectionId] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (state.qrcode && state.connectionId) {
      setQrcode(state.qrcode);
      setConnectionId(state.connectionId);
    }
  }, [state]);

  useEffect(() => {
    if (!connectionId) return;
    pollRef.current = setInterval(async () => {
      setChecking(true);
      const res = await checkWhatsAppStatus(connectionId);
      setChecking(false);
      if (res.status === "CONNECTED") {
        if (pollRef.current) clearInterval(pollRef.current);
        router.refresh();
        onClose();
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
              <div className="field">
                <label>Nome da conexão *</label>
                <input name="label" required placeholder="Ex: WhatsApp Vendas" autoFocus />
              </div>
              <div className="field">
                <label>URL da sua Evolution API *</label>
                <input name="baseUrl" required placeholder="https://evolution.seudominio.com" />
              </div>
              <div className="field">
                <label>API key *</label>
                <input name="apiKey" type="password" required placeholder="sua api key global" />
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
                {pending ? "Criando instância..." : "Criar e gerar QR code"}
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
  const [webhookUrl, setWebhookUrl] = useState("");

  useEffect(() => {
    setWebhookUrl(`${window.location.origin}/api/webhooks/instagram`);
  }, []);

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
  const [webhookUrl, setWebhookUrl] = useState("");

  useEffect(() => {
    setWebhookUrl(`${window.location.origin}/api/webhooks/email/<connectionId>?token=<token> (use "Copiar webhook" na lista)`);
  }, []);

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
