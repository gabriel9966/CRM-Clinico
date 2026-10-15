"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Icon } from "@/components/icons";
import type { AutomationDTO } from "@/lib/types";
import { TRIGGER_LABEL } from "@/lib/automation/types";
import { createAutomation, createQuickReply, toggleAutomation, deleteAutomation } from "@/app/automations/actions";

export function AutomationsView({ automations }: { automations: AutomationDTO[] }) {
  const router = useRouter();
  const [modalOpen, setModalOpen] = useState(false);
  const [quickReplyOpen, setQuickReplyOpen] = useState(false);

  async function handleToggle(id: string, enabled: boolean) {
    await toggleAutomation(id, enabled);
    router.refresh();
  }

  async function handleDelete(id: string) {
    if (!confirm("Excluir esta automação? Essa ação não pode ser desfeita.")) return;
    await deleteAutomation(id);
    router.refresh();
  }

  return (
    <>
      <div className="topbar">
        <div>
          <h1>Automações</h1>
          <div className="sub">Fluxos que rodam sozinhos quando algo acontece no CRM</div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn" onClick={() => setQuickReplyOpen(true)}>Resposta rápida</button>
          <button className="btn primary" onClick={() => setModalOpen(true)}>
            <Icon.plus /> Nova automação
          </button>
        </div>
      </div>

      <div className="content">
        {automations.length === 0 ? (
          <div className="empty-state">
            <Icon.zap />
            <div>Nenhuma automação ainda. Crie fluxos tipo &quot;quando oportunidade entrar em Proposta, enviar mensagem e criar tarefa&quot;.</div>
            <button className="btn primary small" style={{ marginTop: 10 }} onClick={() => setModalOpen(true)}>
              Nova automação
            </button>
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Nome</th><th>Gatilho</th><th>Execuções</th><th>Ativa</th><th></th></tr>
              </thead>
              <tbody>
                {automations.map((a) => (
                  <tr key={a.id} className="row">
                    <td style={{ fontWeight: 700 }}>
                      <Link href={`/automations/${a.id}`} style={{ color: "inherit", textDecoration: "none" }}>{a.name}</Link>
                    </td>
                    <td>{TRIGGER_LABEL[a.trigger] ?? a.trigger}</td>
                    <td>{a.runCount}</td>
                    <td>
                      <label style={{ display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                        <input type="checkbox" checked={a.enabled} onChange={(e) => handleToggle(a.id, e.target.checked)} />
                        <span className="muted" style={{ fontSize: 12 }}>{a.enabled ? "Sim" : "Não"}</span>
                      </label>
                    </td>
                    <td style={{ textAlign: "right" }}>
                      <Link href={`/automations/${a.id}`} className="btn small">Editar</Link>{" "}
                      <button className="btn small danger" onClick={() => handleDelete(a.id)}><Icon.trash /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {modalOpen && <NewAutomationModal onClose={() => setModalOpen(false)} />}
      {quickReplyOpen && (
        <QuickReplyModal
          onClose={() => setQuickReplyOpen(false)}
          onCreate={async (name, text) => {
            await createQuickReply(name, text);
            setQuickReplyOpen(false);
            router.refresh();
          }}
        />
      )}
    </>
  );
}

function QuickReplyModal({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: (name: string, text: string) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Resposta rápida</h2>
          <button className="close-x" onClick={onClose}><Icon.close /></button>
        </div>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            setBusy(true);
            try {
              await onCreate(String(fd.get("name") || ""), String(fd.get("text") || ""));
            } finally {
              setBusy(false);
            }
          }}
        >
          <div className="modal-body">
            <p style={{ fontSize: 12, color: "var(--text-faint)", marginBottom: 14 }}>
              Responde automaticamente toda mensagem recebida de qualquer canal conectado — sem precisar montar um fluxo.
              Pra regras mais específicas (por palavra-chave, horário, etc.), use uma automação normal com condições.
            </p>
            <div className="field">
              <label>Nome *</label>
              <input name="name" required placeholder="Ex: Fora do horário comercial" autoFocus />
            </div>
            <div className="field">
              <label>Texto da resposta *</label>
              <textarea name="text" required placeholder="Obrigado pelo contato! Em breve alguém da equipe responde." />
            </div>
          </div>
          <div className="modal-foot">
            <button type="button" className="btn" onClick={onClose}>Cancelar</button>
            <button type="submit" className="btn primary" disabled={busy}>Criar resposta rápida</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function NewAutomationModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Nova automação</h2>
          <button className="close-x" onClick={onClose}><Icon.close /></button>
        </div>
        <form action={async (fd) => {
          await createAutomation(String(fd.get("name") || ""), String(fd.get("trigger") || "STAGE_CHANGED"));
        }}>
          <div className="modal-body">
            <div className="field">
              <label>Nome *</label>
              <input name="name" required placeholder="Ex: Boas-vindas a novo lead" autoFocus />
            </div>
            <div className="field">
              <label>Gatilho *</label>
              <select name="trigger" defaultValue="STAGE_CHANGED">
                {Object.entries(TRIGGER_LABEL).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="modal-foot">
            <button type="button" className="btn" onClick={onClose}>Cancelar</button>
            <button type="submit" className="btn primary">Criar e abrir editor</button>
          </div>
        </form>
      </div>
    </div>
  );
}
