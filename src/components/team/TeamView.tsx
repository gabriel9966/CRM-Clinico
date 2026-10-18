"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef, useState } from "react";
import { Icon } from "@/components/icons";
import { initials, fmtMoney, STAGE_COLORS } from "@/lib/format";
import type { TeamMemberDTO, PipelineDTO, ConnectionDTO } from "@/lib/types";
import { createTeamMember, updateTeamMember, updateTeamMemberAccess, deleteTeamMember, toggleTeamMemberActive, type TeamMemberState, type TeamAccessInput } from "@/app/team/actions";
import { MODULE_PERMISSIONS } from "@/lib/access-policy";

const initialState: TeamMemberState = {};

export function TeamView({
  team,
  pipelines,
  connections,
  contactsByOwner,
  dealsByOwnerStage,
  currentUserId,
}: {
  team: TeamMemberDTO[];
  pipelines: PipelineDTO[];
  connections: ConnectionDTO[];
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
      p.stages.filter((s) => s.status !== "OPEN").map((s) => s.id)
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
            pipelines={pipelines}
            connections={connections}
            isSelf={editing.id === currentUserId}
            busy={busy}
            onClose={() => setModalOpen(false)}
            onSave={async (name, color, team) => {
              setBusy(true);
              try {
                await updateTeamMember(editing.id, { name, color, team });
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
            onSaveAccess={async (access) => {
              setBusy(true);
              try {
                const result = await updateTeamMemberAccess(editing.id, access);
                if (result?.error) alert(result.error);
                else router.refresh();
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
                    <label>Equipe</label>
                    <input name="team" defaultValue="Geral" placeholder="Ex: Comercial" />
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
  pipelines,
  connections,
  isSelf,
  busy,
  onClose,
  onSave,
  onDelete,
  onToggleActive,
  onSaveAccess,
}: {
  member: TeamMemberDTO;
  pipelines: PipelineDTO[];
  connections: ConnectionDTO[];
  isSelf: boolean;
  busy: boolean;
  onClose: () => void;
  onSave: (name: string, color: string, team: string) => void;
  onDelete: () => void;
  onToggleActive: (isActive: boolean) => void;
  onSaveAccess: (input: TeamAccessInput) => void;
}) {
  const [name, setName] = useState(member.name);
  const [color, setColor] = useState(member.color);
  const [team, setTeam] = useState(member.team);
  const [role, setRole] = useState<TeamAccessInput["role"]>(member.role);
  const [permissions, setPermissions] = useState<string[]>(member.permissions);
  const [pipelineAccesses, setPipelineAccesses] = useState<TeamAccessInput["pipelineAccesses"]>(member.pipelineAccesses.map((item) => ({ pipelineId: item.pipelineId, canEdit: item.canEdit })));
  const [connectionAccesses, setConnectionAccesses] = useState<TeamAccessInput["connectionAccesses"]>(member.connectionAccesses.map((item) => ({ connectionId: item.connectionId, canSend: item.canSend })));

  function togglePermission(permission: string) {
    setPermissions((current) => current.includes(permission) ? current.filter((item) => item !== permission) : [...current, permission]);
  }
  function togglePipeline(pipelineId: string) {
    setPipelineAccesses((current) => current.some((item) => item.pipelineId === pipelineId) ? current.filter((item) => item.pipelineId !== pipelineId) : [...current, { pipelineId, canEdit: true }]);
  }
  function toggleConnection(connectionId: string) {
    setConnectionAccesses((current) => current.some((item) => item.connectionId === connectionId) ? current.filter((item) => item.connectionId !== connectionId) : [...current, { connectionId, canSend: true }]);
  }

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
            onSave(name, color, team);
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
              <label>Equipe</label>
              <input value={team} onChange={(e) => setTeam(e.target.value)} placeholder="Ex: Comercial" />
            </div>
            {!isSelf && <>
              <div className="field">
                <label>Perfil de acesso</label>
                <select value={role} onChange={(event) => setRole(event.target.value as TeamAccessInput["role"])}>
                  <option value="MEMBER">Membro — acesso configurável</option>
                  <option value="ADMIN">Administrador — acesso total</option>
                </select>
                <p className="field-help">Administradores podem gerir a conta. Membros usam apenas os módulos e escopos selecionados abaixo.</p>
              </div>
              {role === "MEMBER" && <>
                <div className="field">
                  <label>Módulos permitidos</label>
                  <div className="access-grid">
                    {MODULE_PERMISSIONS.map((permission) => <label key={permission} className="access-check"><input type="checkbox" checked={permissions.includes(permission)} onChange={() => togglePermission(permission)} /> {permission}</label>)}
                  </div>
                </div>
                <div className="field">
                  <label>Pipelines que pode visualizar e operar</label>
                  <div className="access-grid">
                    {pipelines.map((pipeline) => {
                      const access = pipelineAccesses.find((item) => item.pipelineId === pipeline.id);
                      return <label key={pipeline.id} className="access-check"><input type="checkbox" checked={Boolean(access)} onChange={() => togglePipeline(pipeline.id)} /> {pipeline.name}{access && <span><input type="checkbox" checked={access.canEdit} onChange={() => setPipelineAccesses((items) => items.map((item) => item.pipelineId === pipeline.id ? { ...item, canEdit: !item.canEdit } : item))} /> editar</span>}</label>;
                    })}
                  </div>
                </div>
                <div className="field">
                  <label>Instâncias e canais permitidos</label>
                  <div className="access-grid">
                    {connections.map((connection) => {
                      const access = connectionAccesses.find((item) => item.connectionId === connection.id);
                      return <label key={connection.id} className="access-check"><input type="checkbox" checked={Boolean(access)} onChange={() => toggleConnection(connection.id)} /> {connection.label} ({connection.provider}){access && <span><input type="checkbox" checked={access.canSend} onChange={() => setConnectionAccesses((items) => items.map((item) => item.connectionId === connection.id ? { ...item, canSend: !item.canSend } : item))} /> enviar</span>}</label>;
                    })}
                  </div>
                </div>
              </>}
            </>}
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
            <button type="submit" className="btn primary" disabled={busy}>Salvar dados</button>
            {!isSelf && <button type="button" className="btn primary" disabled={busy} onClick={() => onSaveAccess({ role, permissions, pipelineAccesses, connectionAccesses })}>Salvar acessos</button>}
          </div>
        </form>
      </div>
    </div>
  );
}
