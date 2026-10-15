"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef, useState } from "react";
import { Icon } from "@/components/icons";
import { initials, fmtMoney, STAGE_COLORS } from "@/lib/format";
import type { TeamMemberDTO, PipelineDTO } from "@/lib/types";
import { createTeamMember, updateTeamMember, deleteTeamMember, toggleTeamMemberActive, type TeamMemberState } from "@/app/team/actions";

const initialState: TeamMemberState = {};

export function TeamView({
  team,
  pipelines,
  contactsByOwner,
  dealsByOwnerStage,
  currentUserId,
}: {
  team: TeamMemberDTO[];
  pipelines: PipelineDTO[];
  /** Quantos contatos cada atendente tem (somado no banco). */
  contactsByOwner: Record<string, number>;
  /** Negócios por atendente e etapa (somados no banco). */
  dealsByOwnerStage: { ownerId: string | null; stageId: string; count: number; sum: number }[];
  currentUserId: string;
}) {
  const router = useRouter();

  // "Em aberto" = negócios fora das etapas Ganho/Perdido (mesma convenção do dashboard).
  const closedStageIds = new Set(
    pipelines.flatMap((p) =>
      p.stages.filter((s) => ["ganho", "perdido"].includes(s.label.trim().toLowerCase())).map((s) => s.id)
    )
  );
  const openByOwner = new Map<string, { count: number; sum: number }>();
  for (const d of dealsByOwnerStage) {
    if (!d.ownerId || closedStageIds.has(d.stageId)) continue;
    const cur = openByOwner.get(d.ownerId) ?? { count: 0, sum: 0 };
    cur.count += d.count;
    cur.sum += d.sum;
    openByOwner.set(d.ownerId, cur);
  }
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<TeamMemberDTO | null>(null);
  const [formState, formAction, pending] = useActionState(createTeamMember, initialState);
  const [busy, setBusy] = useState(false);
  const [newColor, setNewColor] = useState(STAGE_COLORS[0]);
  const wasPending = useRef(false);

  useEffect(() => {
    if (wasPending.current && !pending && !formState.error) {
      setModalOpen(false);
      router.refresh();
    }
    wasPending.current = pending;
  }, [pending, formState, router]);

  function openNew() {
    setEditing(null);
    setModalOpen(true);
  }
  function openEdit(m: TeamMemberDTO) {
    setEditing(m);
    setModalOpen(true);
  }

  return (
    <>
      <div className="topbar">
        <div>
          <h1>Equipe</h1>
          <div className="sub">Quem atende cada contato e oportunidade</div>
        </div>
        <button className="btn primary" onClick={openNew}><Icon.plus /> Novo membro</button>
      </div>

      <div className="content">
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Atendente</th><th>Contatos</th><th>Negócios em aberto</th><th>Valor em aberto</th><th>Rodízio</th></tr>
            </thead>
            <tbody>
              {team.length === 0 ? (
                <tr><td colSpan={4}><div className="empty-state"><Icon.empty /><div>Nenhum membro de equipe ainda</div></div></td></tr>
              ) : (
                team.map((m) => {
                  const contactsCount = contactsByOwner[m.id] ?? 0;
                  const open = openByOwner.get(m.id) ?? { count: 0, sum: 0 };
                  const openValue = open.sum;
                  return (
                    <tr key={m.id} className="row" onClick={() => openEdit(m)}>
                      <td>
                        <div className="name-cell">
                          <span className="avatar md" style={{ background: m.color }}>{initials(m.name)}</span>
                          {m.name}
                        </div>
                      </td>
                      <td>{contactsCount}</td>
                      <td>{open.count}</td>
                      <td style={{ fontWeight: 700 }}>{fmtMoney(openValue)}</td>
                      <td>
                        <span className="pill" style={{ background: m.isActive ? "var(--green-soft)" : "var(--border-soft)", color: m.isActive ? "var(--green)" : "var(--text-faint)" }}>
                          {m.isActive ? "Ativo" : "Inativo"}
                        </span>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {modalOpen && (
        editing ? (
          <EditMemberModal
            member={editing}
            isSelf={editing.id === currentUserId}
            busy={busy}
            onClose={() => setModalOpen(false)}
            onSave={async (name, color) => {
              setBusy(true);
              try {
                await updateTeamMember(editing.id, { name, color });
                router.refresh();
                setModalOpen(false);
              } finally {
                setBusy(false);
              }
            }}
            onToggleActive={async (isActive) => {
              setBusy(true);
              try {
                await toggleTeamMemberActive(editing.id, isActive);
                router.refresh();
              } finally {
                setBusy(false);
              }
            }}
            onDelete={async () => {
              setBusy(true);
              try {
                const res = await deleteTeamMember(editing.id);
                if (res?.error) {
                  alert(res.error);
                } else {
                  router.refresh();
                  setModalOpen(false);
                }
              } finally {
                setBusy(false);
              }
            }}
          />
        ) : (
          <div className="modal-overlay" onClick={() => setModalOpen(false)}>
            <div className="modal" onClick={(e) => e.stopPropagation()}>
              <div className="modal-head">
                <h2>Novo membro da equipe</h2>
                <button className="close-x" onClick={() => setModalOpen(false)}><Icon.close /></button>
              </div>
              <form action={formAction}>
                <div className="modal-body">
                  <div className="field">
                    <label>Nome *</label>
                    <input name="name" required placeholder="Ex: Juliana Prado" autoFocus />
                  </div>
                  <div className="field">
                    <label>E-mail (login) *</label>
                    <input name="email" type="email" required placeholder="juliana@empresa.com" />
                  </div>
                  <div className="field">
                    <label>Senha provisória *</label>
                    <input name="password" type="password" required placeholder="mínimo 6 caracteres" />
                  </div>
                  <div className="field">
                    <label>Cor do avatar</label>
                    <div className="swatch-row">
                      {STAGE_COLORS.map((c) => (
                        <span
                          key={c}
                          className={`swatch ${newColor === c ? "selected" : ""}`}
                          style={{ background: c }}
                          onClick={() => setNewColor(c)}
                        />
                      ))}
                    </div>
                    <input type="hidden" name="color" value={newColor} readOnly />
                  </div>
                  {formState.error && (
                    <p style={{ color: "var(--red)", fontSize: 13, fontWeight: 600 }}>{formState.error}</p>
                  )}
                </div>
                <div className="modal-foot">
                  <button type="button" className="btn" onClick={() => setModalOpen(false)}>Cancelar</button>
                  <button type="submit" className="btn primary" disabled={pending}>Adicionar membro</button>
                </div>
              </form>
            </div>
          </div>
        )
      )}
    </>
  );
}

function EditMemberModal({
  member,
  isSelf,
  busy,
  onClose,
  onSave,
  onDelete,
  onToggleActive,
}: {
  member: TeamMemberDTO;
  isSelf: boolean;
  busy: boolean;
  onClose: () => void;
  onSave: (name: string, color: string) => void;
  onDelete: () => void;
  onToggleActive: (isActive: boolean) => void;
}) {
  const [name, setName] = useState(member.name);
  const [color, setColor] = useState(member.color);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Editar membro</h2>
          <button className="close-x" onClick={onClose}><Icon.close /></button>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onSave(name, color);
          }}
        >
          <div className="modal-body">
            <div className="field">
              <label>Nome *</label>
              <input required value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="field">
              <label>E-mail</label>
              <input value={member.email} disabled />
            </div>
            <div className="field">
              <label>Cor do avatar</label>
              <div className="swatch-row">
                {STAGE_COLORS.map((c) => (
                  <span
                    key={c}
                    className={`swatch ${color === c ? "selected" : ""}`}
                    style={{ background: c }}
                    onClick={() => setColor(c)}
                  />
                ))}
              </div>
            </div>
            {!isSelf && (
              <div className="field">
                <label>
                  <input
                    type="checkbox"
                    checked={member.isActive}
                    onChange={(e) => onToggleActive(e.target.checked)}
                    style={{ marginRight: 6 }}
                  />
                  Participa do rodízio de novos contatos
                </label>
              </div>
            )}
          </div>
          <div className="modal-foot">
            {!isSelf && (
              <button
                type="button"
                className="btn danger"
                disabled={busy}
                onClick={() => {
                  if (confirm(`Excluir ${member.name}? Contatos e negócios dela(e) ficarão sem responsável.`)) onDelete();
                }}
              >
                <Icon.trash /> Excluir
              </button>
            )}
            <div style={{ flex: 1 }} />
            <button type="button" className="btn" onClick={onClose}>Cancelar</button>
            <button type="submit" className="btn primary" disabled={busy}>Salvar</button>
          </div>
        </form>
      </div>
    </div>
  );
}
