"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Icon } from "@/components/icons";
import type { AutomationDTO, AutomationRunDTO } from "@/lib/types";
import { TRIGGER_LABEL } from "@/lib/automation/types";
import { createAutomation, createAutomationRecipe, createQuickReply, toggleAutomation, deleteAutomation } from "@/app/automations/actions";

export function AutomationsView({ automations, runs }: { automations: AutomationDTO[]; runs: AutomationRunDTO[] }) {
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
        <section className="automation-recipes" aria-label="Automações recomendadas">
          <div>
            <span className="eyebrow">COMECE RÁPIDO</span>
            <h2>Rotinas que evitam leads esquecidos</h2>
            <p>Crie uma regra pronta e ajuste os detalhes no editor visual quando quiser.</p>
          </div>
          <div className="recipe-actions">
            <button className="recipe-card" onClick={async () => { await createAutomationRecipe("lead_follow_up"); router.refresh(); }}>
              <Icon.tasks /><span><strong>Follow-up de novo lead</strong><small>Cria uma tarefa após 1 dia</small></span><b>Adicionar</b>
            </button>
            <button className="recipe-card" onClick={async () => { await createAutomationRecipe("inbox_task"); router.refresh(); }}>
              <Icon.chat /><span><strong>Mensagem sem resposta</strong><small>Gera tarefa para o atendente</small></span><b>Adicionar</b>
            </button>
          </div>
        </section>
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

        <section style={{ marginTop: 28 }} aria-label="Histórico de execuções">
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 10 }}>
            <div>
              <h2 style={{ fontSize: 18, margin: 0 }}>Histórico de execuções</h2>
              <p className="muted" style={{ fontSize: 12, margin: "4px 0 0" }}>Sucessos, esperas e falhas das últimas 80 execuções.</p>
            </div>
            <span className="muted" style={{ fontSize: 12 }}>{runs.filter((r) => r.status === "FAILED").length} falha(s)</span>
          </div>
          {runs.length === 0 ? (
            <div className="empty-state" style={{ padding: 24 }}>As execuções aparecerão aqui assim que uma automação for acionada.</div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Automação</th><th>Status</th><th>Contexto</th><th>Detalhe</th><th>Início</th></tr></thead>
                <tbody>
                  {runs.map((run) => (
                    <tr key={run.id}>
                      <td><Link href={`/automations/${run.automationId}`}>{run.automationName}</Link></td>
                      <td>
                        <span className={run.status === "FAILED" ? "badge red" : run.status === "COMPLETED" ? "badge green" : "badge"}>
                          {run.status === "FAILED" ? "Falhou" : run.status === "COMPLETED" ? "Concluída" : run.status === "WAITING" ? "Em espera" : "Executando"}
                        </span>
                      </td>
                      <td className="muted">{run.contactId ? "Contato" : run.opportunityId ? "Negócio" : "Sem registro"}</td>
                      <td className="muted" style={{ maxWidth: 260 }}>{run.detail ?? "—"}</td>
                      <td className="muted">{new Date(run.startedAt).toLocaleString("pt-BR")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
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
