"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef, useState } from "react";
import { Icon } from "@/components/icons";
import { initials, fmtMoney, STAGE_COLORS } from "@/lib/format";
import type { TeamMemberDTO, PipelineDTO, ConnectionDTO } from "@/lib/types";
import { createTeamMember, updateTeamMember, updateTeamMemberAccess, deleteTeamMember, toggleTeamMemberActive, type TeamMemberState, type TeamAccessInput } from "@/app/team/actions";
import { MODULE_PERMISSIONS } from "@/lib/access-policy";
import { ACCESS_PROFILES, DATA_SCOPES, PERMISSION_INFO, matchProfile, type DataScope } from "@/lib/access-scope";

const initialState: TeamMemberState = {};

const SCOPE_SHORT: Record<string, string> = { own: "Só os dele", team: "Da equipe", all: "Todos" };

function profileLabel(m: Pick<TeamMemberDTO, "role" | "dataScope" | "seeUnassigned" | "permissions">) {
  const id = matchProfile(m);
  return ACCESS_PROFILES.find((p) => p.id === id)?.label ?? "Personalizado";
}

/** Acesso inicial de um membro novo: perfil Atendente, todos os pipelines e canais. */
function defaultAccess(pipelines: PipelineDTO[], connections: ConnectionDTO[]): TeamAccessInput {
  const profile = ACCESS_PROFILES[0];
  return {
    role: profile.role,
    permissions: [...profile.permissions],
    dataScope: profile.dataScope,
    seeUnassigned: profile.seeUnassigned,
    pipelineAccesses: pipelines.map((p) => ({ pipelineId: p.id, canEdit: profile.permissions.includes("pipeline.write") })),
    connectionAccesses: connections.map((c) => ({ connectionId: c.id, canSend: profile.permissions.includes("conversations.reply") })),
  };
}

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
  const closedStageIds = new Set(pipelines.flatMap((p) => p.stages.filter((s) => s.status !== "OPEN").map((s) => s.id)));
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
  const [newAccess, setNewAccess] = useState<TeamAccessInput>(() => defaultAccess(pipelines, connections));
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
    setNewAccess(defaultAccess(pipelines, connections));
    setModalOpen(true);
  }

  return (
    <>
      <div className="topbar">
        <div>
          <h1>Equipe</h1>
          <div className="sub">Quem atende cada contato e o que cada pessoa pode ver e fazer</div>
        </div>
        <button className="btn primary" onClick={openNew}><Icon.plus /> Novo membro</button>
      </div>

      <div className="content">
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Atendente</th><th>Perfil de acesso</th><th>Vê</th><th>Contatos</th><th>Negócios em aberto</th><th>Valor em aberto</th><th>Rodízio</th></tr>
            </thead>
            <tbody>
              {team.length === 0 ? (
                <tr><td colSpan={7}><div className="empty-state"><Icon.empty /><div>Nenhum membro de equipe ainda</div></div></td></tr>
              ) : (
                team.map((m) => {
                  const open = openByOwner.get(m.id) ?? { count: 0, sum: 0 };
                  return (
                    <tr key={m.id} className="row" onClick={() => { setEditing(m); setModalOpen(true); }}>
                      <td>
                        <div className="name-cell">
                          <span className="avatar md" style={{ background: m.color }}>{initials(m.name)}</span>
                          <span>{m.name}<span className="team-sub">{m.team}</span></span>
                        </div>
                      </td>
                      <td><span className={`pill ${m.role === "ADMIN" ? "access-admin" : "access-member"}`}>{profileLabel(m)}</span></td>
                      <td>{SCOPE_SHORT[m.role === "ADMIN" ? "all" : m.dataScope] ?? "Só os dele"}{m.role !== "ADMIN" && m.dataScope !== "all" && m.seeUnassigned ? " + fila" : ""}</td>
                      <td>{contactsByOwner[m.id] ?? 0}</td>
                      <td>{open.count}</td>
                      <td style={{ fontWeight: 600 }}>{fmtMoney(open.sum)}</td>
                      <td>
                        <span className="pill" style={{ background: m.isActive ? "var(--green-soft)" : "var(--surface-muted)", color: m.isActive ? "var(--green)" : "var(--text-faint)" }}>
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
            onSave={async (name, color, teamName) => {
              setBusy(true);
              try {
                await updateTeamMember(editing.id, { name, color, team: teamName });
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
                else { router.refresh(); setModalOpen(false); }
              } finally {
                setBusy(false);
              }
            }}
            onDelete={async () => {
              setBusy(true);
              try {
                const res = await deleteTeamMember(editing.id);
                if (res?.error) alert(res.error);
                else { router.refresh(); setModalOpen(false); }
              } finally {
                setBusy(false);
              }
            }}
          />
        ) : (
          <div className="modal-overlay" onClick={() => setModalOpen(false)}>
            <div className="modal wide team-modal" onClick={(e) => e.stopPropagation()}>
              <div className="modal-head">
                <h2>Novo membro da equipe</h2>
                <button className="close-x" onClick={() => setModalOpen(false)} aria-label="Fechar"><Icon.close /></button>
              </div>
              <form action={formAction}>
                <div className="modal-body">
                  <div className="field-row">
                    <div className="field">
                      <label>Nome *</label>
                      <input name="name" required placeholder="Ex: Juliana Prado" autoFocus />
                    </div>
                    <div className="field">
                      <label>Equipe</label>
                      <input name="team" defaultValue="Geral" placeholder="Ex: Comercial" />
                    </div>
                  </div>
                  <div className="field-row">
                    <div className="field">
                      <label>E-mail (login) *</label>
                      <input name="email" type="email" required placeholder="juliana@empresa.com" />
                    </div>
                    <div className="field">
                      <label>Senha provisória *</label>
                      <input name="password" type="password" required minLength={12} maxLength={72} placeholder="mínimo 12 caracteres" />
                    </div>
                  </div>
                  <div className="field">
                    <label>Cor do avatar</label>
                    <div className="swatch-row">
                      {STAGE_COLORS.map((c) => (
                        <span key={c} className={`swatch ${newColor === c ? "selected" : ""}`} style={{ background: c }} onClick={() => setNewColor(c)} />
                      ))}
                    </div>
                    <input type="hidden" name="color" value={newColor} readOnly />
                  </div>

                  <AccessEditor value={newAccess} onChange={setNewAccess} pipelines={pipelines} connections={connections} />
                  <input type="hidden" name="access" value={JSON.stringify(newAccess)} readOnly />

                  {formState.error && <p className="form-error" role="alert">{formState.error}</p>}
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

/** Editor de acessos: perfil pronto + carteira + módulos + pipelines + canais. */
function AccessEditor({
  value,
  onChange,
  pipelines,
  connections,
}: {
  value: TeamAccessInput;
  onChange: (next: TeamAccessInput) => void;
  pipelines: PipelineDTO[];
  connections: ConnectionDTO[];
}) {
  const profileId = matchProfile(value);
  const set = (patch: Partial<TeamAccessInput>) => onChange({ ...value, ...patch });

  function applyProfile(id: string) {
    const profile = ACCESS_PROFILES.find((p) => p.id === id);
    if (!profile) return;
    const canEdit = profile.permissions.includes("pipeline.write");
    const canSend = profile.permissions.includes("conversations.reply");
    const pipes = value.pipelineAccesses.length ? value.pipelineAccesses : pipelines.map((p) => ({ pipelineId: p.id, canEdit }));
    const conns = value.connectionAccesses.length ? value.connectionAccesses : connections.map((c) => ({ connectionId: c.id, canSend }));
    onChange({
      role: profile.role,
      permissions: [...profile.permissions],
      dataScope: profile.dataScope,
      seeUnassigned: profile.seeUnassigned,
      pipelineAccesses: pipes.map((p) => ({ ...p, canEdit })),
      connectionAccesses: conns.map((c) => ({ ...c, canSend })),
    });
  }

  const togglePermission = (permission: string) =>
    set({ permissions: value.permissions.includes(permission) ? value.permissions.filter((p) => p !== permission) : [...value.permissions, permission] });

  const pipelineMode = (id: string) => {
    const access = value.pipelineAccesses.find((a) => a.pipelineId === id);
    return access ? (access.canEdit ? "edit" : "view") : "none";
  };
  const setPipelineMode = (id: string, mode: string) =>
    set({ pipelineAccesses: [...value.pipelineAccesses.filter((a) => a.pipelineId !== id), ...(mode === "none" ? [] : [{ pipelineId: id, canEdit: mode === "edit" }])] });

  const connectionMode = (id: string) => {
    const access = value.connectionAccesses.find((a) => a.connectionId === id);
    return access ? (access.canSend ? "send" : "view") : "none";
  };
  const setConnectionMode = (id: string, mode: string) =>
    set({ connectionAccesses: [...value.connectionAccesses.filter((a) => a.connectionId !== id), ...(mode === "none" ? [] : [{ connectionId: id, canSend: mode === "send" }])] });

  const areas = [...new Set(MODULE_PERMISSIONS.map((p) => PERMISSION_INFO[p].area))];
  const scope = DATA_SCOPES.find((s) => s.id === value.dataScope) ?? DATA_SCOPES[0];

  return (
    <section className="access-editor" aria-label="Níveis de acesso">
      <div className="access-editor-head">
        <div className="field">
          <label>Perfil de acesso</label>
          <select value={profileId} onChange={(e) => applyProfile(e.target.value)}>
            {ACCESS_PROFILES.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
            {profileId === "custom" && <option value="custom">Personalizado</option>}
          </select>
          <small className="field-help">
            {ACCESS_PROFILES.find((p) => p.id === profileId)?.description ?? "Combinação própria. Escolha um perfil para recomeçar de um modelo."}
          </small>
        </div>
      </div>

      {value.role === "ADMIN" ? (
        <p className="access-note">Administradores veem e fazem tudo, inclusive equipe, conexões, IA e configurações.</p>
      ) : (
        <>
          <div className="access-block">
            <h4>Quem ele(a) vê <span>contatos, negócios e conversas</span></h4>
            <div className="scope-options" role="radiogroup">
              {DATA_SCOPES.map((s) => (
                <label key={s.id} className={`scope-option ${value.dataScope === s.id ? "active" : ""}`}>
                  <input type="radio" name="dataScope-ui" checked={value.dataScope === s.id} onChange={() => set({ dataScope: s.id as DataScope })} />
                  <strong>{s.label}</strong>
                  <small>{s.help}</small>
                </label>
              ))}
            </div>
            {value.dataScope !== "all" && (
              <label className="access-inline">
                <input type="checkbox" checked={value.seeUnassigned} onChange={(e) => set({ seeUnassigned: e.target.checked })} />
                Também vê leads <strong>sem responsável</strong> (fila de novos contatos) para poder assumi-los
              </label>
            )}
          </div>

          <div className="access-block">
            <h4>O que pode fazer</h4>
            <div className="perm-areas">
              {areas.map((area) => (
                <fieldset key={area} className="perm-area">
                  <legend>{area}</legend>
                  {MODULE_PERMISSIONS.filter((p) => PERMISSION_INFO[p].area === area).map((p) => (
                    <label key={p} className="access-inline">
                      <input type="checkbox" checked={value.permissions.includes(p)} onChange={() => togglePermission(p)} />
                      {PERMISSION_INFO[p].label}
                    </label>
                  ))}
                </fieldset>
              ))}
            </div>
          </div>

          <div className="access-block">
            <h4>Pipelines <span>{value.pipelineAccesses.length} de {pipelines.length}</span></h4>
            {pipelines.length === 0 ? <p className="muted">Nenhum pipeline criado.</p> : (
              <div className="access-rows">
                {pipelines.map((p) => (
                  <div key={p.id} className="access-row">
                    <span>{p.name}{p.group && p.group !== "Geral" ? <small> · {p.group}</small> : null}</span>
                    <select value={pipelineMode(p.id)} onChange={(e) => setPipelineMode(p.id, e.target.value)} aria-label={`Acesso ao pipeline ${p.name}`}>
                      <option value="none">Sem acesso</option>
                      <option value="view">Só ver</option>
                      <option value="edit">Ver e editar</option>
                    </select>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="access-block">
            <h4>Canais / instâncias <span>{value.connectionAccesses.length} de {connections.length}</span></h4>
            {connections.length === 0 ? <p className="muted">Nenhuma conexão criada.</p> : (
              <div className="access-rows">
                {connections.map((c) => (
                  <div key={c.id} className="access-row">
                    <span>{c.label}<small> · {c.provider.replace("WHATSAPP_", "WhatsApp ").replace("INSTAGRAM", "Instagram").replace("EMAIL", "E-mail")}</small></span>
                    <select value={connectionMode(c.id)} onChange={(e) => setConnectionMode(c.id, e.target.value)} aria-label={`Acesso ao canal ${c.label}`}>
                      <option value="none">Sem acesso</option>
                      <option value="view">Só ver</option>
                      <option value="send">Ver e responder</option>
                    </select>
                  </div>
                ))}
              </div>
            )}
          </div>

          <p className="access-summary">
            <strong>Resumo:</strong> vê {scope.label.toLowerCase()}{value.dataScope !== "all" && value.seeUnassigned ? " + fila sem responsável" : ""} · {value.permissions.length} permissões · {value.pipelineAccesses.length} pipeline(s) · {value.connectionAccesses.length} canal(is)
          </p>
        </>
      )}
    </section>
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
  const [access, setAccess] = useState<TeamAccessInput>({
    role: member.role,
    permissions: member.permissions,
    dataScope: (member.role === "ADMIN" ? "all" : member.dataScope) as DataScope,
    seeUnassigned: member.seeUnassigned,
    pipelineAccesses: member.pipelineAccesses.map((item) => ({ pipelineId: item.pipelineId, canEdit: item.canEdit })),
    connectionAccesses: member.connectionAccesses.map((item) => ({ connectionId: item.connectionId, canSend: item.canSend })),
  });

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal wide team-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>{member.name}</h2>
          <button className="close-x" onClick={onClose} aria-label="Fechar"><Icon.close /></button>
        </div>
        <form onSubmit={(e) => { e.preventDefault(); onSave(name, color, team); }}>
          <div className="modal-body">
            <div className="field-row">
              <div className="field">
                <label>Nome *</label>
                <input required value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="field">
                <label>Equipe</label>
                <input value={team} onChange={(e) => setTeam(e.target.value)} placeholder="Ex: Comercial" />
                <small className="field-help">Usada na carteira “Da minha equipe”.</small>
              </div>
            </div>
            <div className="field">
              <label>E-mail</label>
              <input value={member.email} disabled />
            </div>
            <div className="field">
              <label>Cor do avatar</label>
              <div className="swatch-row">
                {STAGE_COLORS.map((c) => (
                  <span key={c} className={`swatch ${color === c ? "selected" : ""}`} style={{ background: c }} onClick={() => setColor(c)} />
                ))}
              </div>
            </div>
            {!isSelf && (
              <div className="field">
                <label className="access-inline">
                  <input type="checkbox" checked={member.isActive} onChange={(e) => onToggleActive(e.target.checked)} />
                  Participa do rodízio de novos contatos
                </label>
              </div>
            )}

            {isSelf ? (
              <p className="access-note">Para evitar perder o próprio acesso, outro administrador altera as suas permissões.</p>
            ) : (
              <AccessEditor value={access} onChange={setAccess} pipelines={pipelines} connections={connections} />
            )}
          </div>
          <div className="modal-foot">
            {!isSelf && (
              <button type="button" className="btn danger" disabled={busy} onClick={() => { if (confirm(`Excluir ${member.name}? Contatos e negócios dela(e) ficarão sem responsável.`)) onDelete(); }}>
                <Icon.trash /> Excluir
              </button>
            )}
            <div style={{ flex: 1 }} />
            <button type="button" className="btn" onClick={onClose}>Cancelar</button>
            <button type="submit" className="btn" disabled={busy}>Salvar dados</button>
            {!isSelf && <button type="button" className="btn primary" disabled={busy} onClick={() => onSaveAccess(access)}>Salvar acessos</button>}
          </div>
        </form>
      </div>
    </div>
  );
}
