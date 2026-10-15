"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Icon } from "@/components/icons";
import { colorFor, initials, fmtDate, fmtMoney, STAGE_COLORS } from "@/lib/format";
import type { PipelineDTO, DealCardDTO, TeamMemberDTO, CustomFieldDefinitionDTO } from "@/lib/types";
import { CustomFieldInputs, readCustomFieldValues } from "@/components/shared/CustomFieldInputs";
import { EntityPicker } from "@/components/shared/EntityPicker";
import {
  createPipeline,
  renamePipeline,
  deletePipeline,
  addStage,
  renameStage,
  setStageColor,
  moveStage,
  deleteStage,
  createOpportunity,
  updateOpportunity,
  deleteOpportunity,
  moveOpportunityStage,
  importOpportunitiesCsv,
} from "@/app/pipeline/actions";
import { fetchPipelineBoard, fetchStageCards } from "@/app/listings/actions";
import { ImportCsvModal } from "@/components/shared/ImportCsvModal";

type Modal =
  | { type: "opportunity"; data: DealCardDTO | null }
  | { type: "pipeline-new" }
  | { type: "pipeline-manage"; pipelineId: string }
  | { type: "import" };

// Uma coluna do quadro: totais vêm do banco (quantidade e valor de TODA a
// etapa); os cartões são só a página carregada até agora.
type Column = { count: number; sum: number; cards: DealCardDTO[]; nextCursor: string | null; loadingMore?: boolean };
type Board = Record<string, Column>;

const SEARCH_DEBOUNCE_MS = 300;

export function PipelineBoard({
  pipelines,
  initialPipelineId,
  initialBoard,
  team,
  customFieldDefs,
  lossReasons,
}: {
  pipelines: PipelineDTO[];
  initialPipelineId: string;
  initialBoard: Board;
  team: TeamMemberDTO[];
  customFieldDefs: CustomFieldDefinitionDTO[];
  lossReasons: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [currentPipelineId, setCurrentPipelineId] = useState(initialPipelineId || pipelines[0]?.id || "");
  const [board, setBoard] = useState<Board>(initialBoard);
  const [boardLoading, setBoardLoading] = useState(false);
  const [boardError, setBoardError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [ownerFilter, setOwnerFilter] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const [modal, setModal] = useState<Modal | null>(null);
  const [pendingPipelineId, setPendingPipelineId] = useState<string | null>(null);
  const [dragOverStage, setDragOverStage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const pipeline = pipelines.find((p) => p.id === currentPipelineId) ?? pipelines[0];
  const stages = useMemo(() => (pipeline ? [...pipeline.stages].sort((a, b) => a.order - b.order) : []), [pipeline]);
  const stageKey = stages.map((s) => s.id).join(",");

  const requestId = useRef(0);
  const firstRun = useRef(true);

  function ownerOf(id: string | null) {
    return id ? team.find((m) => m.id === id) : undefined;
  }

  // Recarrega o quadro ao trocar de pipeline, mudar as etapas, filtrar ou depois de uma edição.
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    if (!currentPipelineId) return;
    const mine = ++requestId.current;
    const timer = setTimeout(async () => {
      setBoardLoading(true);
      setBoardError(null);
      try {
        const next = await fetchPipelineBoard(currentPipelineId, {
          ownerId: ownerFilter || undefined,
          q: search.trim() || undefined,
        });
        if (mine === requestId.current) setBoard(next);
      } catch {
        if (mine === requestId.current) setBoardError("Não foi possível carregar o quadro. Tente de novo.");
      } finally {
        if (mine === requestId.current) setBoardLoading(false);
      }
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [currentPipelineId, stageKey, ownerFilter, search, reloadKey]);

  const loadMore = useCallback(
    async (stageId: string) => {
      const col = board[stageId];
      if (!col?.nextCursor || col.loadingMore) return;
      setBoard((b) => ({ ...b, [stageId]: { ...b[stageId], loadingMore: true } }));
      try {
        const page = await fetchStageCards(stageId, {
          cursor: col.nextCursor,
          ownerId: ownerFilter || undefined,
          q: search.trim() || undefined,
        });
        setBoard((b) => {
          const cur = b[stageId];
          if (!cur) return b;
          const known = new Set(cur.cards.map((c) => c.id));
          return {
            ...b,
            [stageId]: {
              ...cur,
              cards: [...cur.cards, ...page.items.filter((c) => !known.has(c.id))],
              nextCursor: page.nextCursor,
              loadingMore: false,
            },
          };
        });
      } catch {
        setBoard((b) => (b[stageId] ? { ...b, [stageId]: { ...b[stageId], loadingMore: false } } : b));
      }
    },
    [board, ownerFilter, search]
  );

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    try {
      await fn();
      setReloadKey((k) => k + 1);
      router.refresh(); // etapas/pipelines podem ter mudado
    } finally {
      setBusy(false);
    }
  }

  function closeModal() {
    setModal(null);
    setPendingPipelineId(null);
  }

  // ---------- Estatísticas (somadas dos totais de cada etapa, vindos do banco) ----------
  const kindOf = (label: string) => {
    const l = label.trim().toLowerCase();
    return l === "ganho" ? "won" : l === "perdido" ? "lost" : "open";
  };
  let openCount = 0, openSum = 0, wonCount = 0, wonSum = 0, lostCount = 0;
  for (const s of stages) {
    const col = board[s.id];
    if (!col) continue;
    const kind = kindOf(s.label);
    if (kind === "won") { wonCount += col.count; wonSum += col.sum; }
    else if (kind === "lost") { lostCount += col.count; }
    else { openCount += col.count; openSum += col.sum; }
  }
  const winRate = wonCount + lostCount ? Math.round((wonCount / (wonCount + lostCount)) * 100) : 0;
  const stageCounts = Object.fromEntries(stages.map((s) => [s.id, board[s.id]?.count ?? 0]));

  // ---------- Drag & drop ----------
  function onDrop(e: React.DragEvent, stageId: string) {
    e.preventDefault();
    setDragOverStage(null);
    const id = e.dataTransfer.getData("text/plain");
    if (!id) return;
    run(() => moveOpportunityStage(id, stageId));
  }

  // ---------- Opportunity form ----------
  async function submitOpportunity(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (modal?.type !== "opportunity") return;
    const fd = new FormData(e.currentTarget);
    const tags = String(fd.get("tags") || "").split(",").map((t) => t.trim()).filter(Boolean);
    const payload = {
      title: String(fd.get("title") || ""),
      value: Number(fd.get("value")) || 0,
      tags,
      contactId: String(fd.get("contactId") || ""),
      pipelineId: String(fd.get("pipelineId") || ""),
      stageId: String(fd.get("stageId") || ""),
      ownerId: (String(fd.get("ownerId") || "") || null) as string | null,
      expectedClose: (String(fd.get("expectedClose") || "") || null) as string | null,
      lossReasonId: fd.has("lossReasonId") ? (String(fd.get("lossReasonId") || "") || null) as string | null : undefined,
      customFields: readCustomFieldValues(fd, customFieldDefs, "OPPORTUNITY"),
    };
    const existing = modal.data;
    try {
      await run(async () => {
        if (existing) await updateOpportunity(existing.id, payload);
        else await createOpportunity(payload);
      });
      closeModal();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Não foi possível salvar.");
    }
  }

  return (
    <>
      <div className="topbar">
        <div>
          <h1>Pipeline de Vendas</h1>
          <div className="sub">Acompanhe suas oportunidades em tempo real</div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <a className="btn" href="/api/export/opportunities"><Icon.download /> Exportar CSV</a>
          <button className="btn" onClick={() => setModal({ type: "import" })}><Icon.upload /> Importar CSV</button>
          <button
            className="btn primary"
            onClick={() => setModal({ type: "opportunity", data: null })}
          >
            <Icon.plus /> Nova oportunidade
          </button>
        </div>
      </div>

      <div className="content">
        <div className="pipeline-bar">
          {pipelines.map((p) => (
            <div
              key={p.id}
              className={`pipeline-tab ${p.id === currentPipelineId ? "active" : ""}`}
              onClick={() => setCurrentPipelineId(p.id)}
            >
              {p.name}
            </div>
          ))}
          <button className="btn small ghost" onClick={() => setModal({ type: "pipeline-new" })}>
            <Icon.plus /> Novo pipeline
          </button>
          <span className="sep" />
          <button
            className="btn small"
            onClick={() => pipeline && setModal({ type: "pipeline-manage", pipelineId: pipeline.id })}
          >
            <Icon.settings /> Gerenciar etapas
          </button>
        </div>

        <div className="pipeline-bar" style={{ gap: 8 }}>
          <div className="search-bar" style={{ margin: 0, flex: 1, maxWidth: 360 }}>
            <Icon.search />
            <input placeholder="Buscar negócio ou contato..." value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <select value={ownerFilter} onChange={(e) => setOwnerFilter(e.target.value)} style={{ maxWidth: 220 }}>
            <option value="">Todos os responsáveis</option>
            {team.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
          {boardLoading && <span className="muted" style={{ fontSize: 12 }}>Atualizando…</span>}
        </div>
        {boardError && <p style={{ color: "var(--red)", fontSize: 13, fontWeight: 600, marginBottom: 10 }}>{boardError}</p>}

        <div className="stats-row">
          <div className="stat-card">
            <div className="label">Em aberto</div>
            <div className="value">{fmtMoney(openSum)}</div>
            <div className="delta">{openCount.toLocaleString("pt-BR")} oportunidades</div>
          </div>
          <div className="stat-card">
            <div className="label">Ganhas</div>
            <div className="value" style={{ color: "var(--green)" }}>{fmtMoney(wonSum)}</div>
            <div className="delta">{wonCount.toLocaleString("pt-BR")} negócios fechados</div>
          </div>
          <div className="stat-card">
            <div className="label">Taxa de conversão</div>
            <div className="value">{winRate}%</div>
            <div className="delta">ganhas vs. perdidas</div>
          </div>
          <div className="stat-card">
            <div className="label">Ticket médio</div>
            <div className="value">{fmtMoney(openCount ? openSum / openCount : 0)}</div>
            <div className="delta">oportunidades em aberto</div>
          </div>
        </div>

        {stages.length === 0 ? (
          <div className="empty-state">
            <Icon.empty />
            <div>Este pipeline ainda não tem etapas.</div>
            <button
              className="btn primary small"
              style={{ marginTop: 10 }}
              onClick={() => pipeline && setModal({ type: "pipeline-manage", pipelineId: pipeline.id })}
            >
              Adicionar etapa
            </button>
          </div>
        ) : (
          <div className="kanban">
            {stages.map((stage) => {
              const col = board[stage.id];
              const deals = col?.cards ?? [];
              return (
                <div key={stage.id} className="kanban-col">
                  <div className="kanban-col-head">
                    <div className="title">
                      <span className="pip" style={{ background: stage.color }} />
                      {stage.label}
                    </div>
                    <div className="count">{(col?.count ?? 0).toLocaleString("pt-BR")}</div>
                  </div>
                  <div className="kanban-col-sum">{fmtMoney(col?.sum ?? 0)}</div>
                  <div
                    className={`kanban-cards ${dragOverStage === stage.id ? "drag-over" : ""}`}
                    onDragOver={(e) => {
                      e.preventDefault();
                      setDragOverStage(stage.id);
                    }}
                    onDragLeave={() => setDragOverStage(null)}
                    onDrop={(e) => onDrop(e, stage.id)}
                  >
                    {deals.map((deal) => {
                      const cname = deal.contactName ?? "Sem contato";
                      const owner = ownerOf(deal.ownerId);
                      return (
                        <div
                          key={deal.id}
                          className="deal-card"
                          draggable
                          onDragStart={(e) => e.dataTransfer.setData("text/plain", deal.id)}
                          onClick={() => setModal({ type: "opportunity", data: deal })}
                        >
                          <div className="title">{deal.title}</div>
                          <div className="value">{fmtMoney(deal.value)}</div>
                          {deal.tags.length > 0 && (
                            <div style={{ marginBottom: 8 }}>
                              {deal.tags.map((t) => (
                                <span key={t} className="tag">{t}</span>
                              ))}
                            </div>
                          )}
                          <div className="contact-row">
                            <span className="avatar" style={{ background: colorFor(cname) }}>
                              {initials(cname)}
                            </span>
                            {cname}
                          </div>
                          <div className="deal-card-footer">
                            {owner ? (
                              <span className="contact-row">
                                <span className="avatar" style={{ background: owner.color }}>{initials(owner.name)}</span>
                                <span className="muted">{owner.name}</span>
                              </span>
                            ) : <span className="muted">Sem responsável</span>}
                            {deal.expectedClose && <span className="deal-close">Fecha {fmtDate(deal.expectedClose)}</span>}
                          </div>
                          {deal.lossReason && <div className="deal-risk lost">Perdido: {deal.lossReason}</div>}
                          {!deal.lossReason && deal.expectedClose && new Date(deal.expectedClose).getTime() < Date.now() && <div className="deal-risk">Previsão vencida</div>}
                        </div>
                      );
                    })}
                    {col?.nextCursor && (
                      <button
                        className="btn small ghost"
                        style={{ width: "100%" }}
                        disabled={col.loadingMore}
                        onClick={() => loadMore(stage.id)}
                      >
                        {col.loadingMore ? "Carregando…" : `Carregar mais (${deals.length} de ${col.count})`}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {modal?.type === "opportunity" && (
        <OpportunityModal
          data={modal.data}
          pipelines={pipelines}
          team={team}
          customFieldDefs={customFieldDefs}
          lossReasons={lossReasons}
          defaultPipelineId={currentPipelineId}
          pendingPipelineId={pendingPipelineId}
          setPendingPipelineId={setPendingPipelineId}
          busy={busy}
          onClose={closeModal}
          onSubmit={submitOpportunity}
          onDelete={
            modal.data
              ? () => run(() => deleteOpportunity(modal.data!.id)).then(closeModal)
              : undefined
          }
        />
      )}

      {modal?.type === "pipeline-new" && (
        <PipelineNewModal
          busy={busy}
          onClose={closeModal}
          onSubmit={async (name) => {
            await run(() => createPipeline(name));
            closeModal();
          }}
        />
      )}

      {modal?.type === "pipeline-manage" && pipeline && (
        <PipelineManageModal
          pipeline={pipelines.find((p) => p.id === modal.pipelineId) ?? pipeline}
          stageCounts={stageCounts}
          canDelete={pipelines.length > 1}
          busy={busy}
          onClose={closeModal}
          onRenamePipeline={(name) => run(() => renamePipeline(modal.pipelineId, name))}
          onAddStage={() => run(() => addStage(modal.pipelineId))}
          onRenameStage={(stageId, label) => run(() => renameStage(stageId, label))}
          onSetColor={(stageId, color) => run(() => setStageColor(stageId, color))}
          onMoveStage={(stageId, dir) => run(() => moveStage(modal.pipelineId, stageId, dir))}
          onDeleteStage={(stageId) => run(() => deleteStage(modal.pipelineId, stageId))}
          onDeletePipeline={() =>
            run(() => deletePipeline(modal.pipelineId)).then(() => {
              setCurrentPipelineId(pipelines.find((p) => p.id !== modal.pipelineId)?.id ?? "");
              closeModal();
            })
          }
        />
      )}

      {modal?.type === "import" && (
        <ImportCsvModal
          title="Importar oportunidades (CSV)"
          hint="O contato precisa já existir (casado por e-mail ou nome). Pipeline/etapa/responsável são opcionais e casados pelo nome exato."
          templateColumns="title, value, contact_email, contact_name, pipeline, stage, owner, tags, expected_close"
          onImport={(csv) => importOpportunitiesCsv(csv, currentPipelineId)}
          onClose={closeModal}
          onDone={() => {
            setReloadKey((k) => k + 1);
            router.refresh();
          }}
        />
      )}
    </>
  );
}

function OpportunityModal({
  data,
  pipelines,
  team,
  customFieldDefs,
  lossReasons,
  defaultPipelineId,
  pendingPipelineId,
  setPendingPipelineId,
  busy,
  onClose,
  onSubmit,
  onDelete,
}: {
  data: DealCardDTO | null;
  pipelines: PipelineDTO[];
  team: TeamMemberDTO[];
  customFieldDefs: CustomFieldDefinitionDTO[];
  lossReasons: { id: string; name: string }[];
  defaultPipelineId: string;
  pendingPipelineId: string | null;
  setPendingPipelineId: (id: string) => void;
  busy: boolean;
  onClose: () => void;
  onSubmit: (e: FormEvent<HTMLFormElement>) => void;
  onDelete?: () => void;
}) {
  const editing = !!data;
  const activePipelineId = pendingPipelineId ?? data?.pipelineId ?? defaultPipelineId;
  const activePipeline = pipelines.find((p) => p.id === activePipelineId);
  const stages = activePipeline ? [...activePipeline.stages].sort((a, b) => a.order - b.order) : [];

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>{editing ? "Editar oportunidade" : "Nova oportunidade"}</h2>
          <button className="close-x" onClick={onClose}><Icon.close /></button>
        </div>
        <form onSubmit={onSubmit}>
          <div className="modal-body">
            {data && (
              <div className="opportunity-context">
                <div>
                  <span>Contato vinculado</span>
                  <strong>{data.contactName ?? "Contato"}</strong>
                </div>
                <a className="btn small" href={`/contacts?contact=${data.contactId}`}>Abrir ficha</a>
              </div>
            )}
            <div className="field">
              <label>Título *</label>
              <input name="title" required defaultValue={data?.title} placeholder="Ex: Plano Pro anual" />
            </div>
            <div className="field-row">
              <div className="field">
                <label>Contato *</label>
                <EntityPicker
                  name="contactId"
                  kind="contact"
                  required
                  initial={data ? { id: data.contactId, label: data.contactName ?? "Contato" } : null}
                />
              </div>
              <div className="field">
                <label>Valor (R$)</label>
                <input name="value" type="number" min={0} step={1} defaultValue={data?.value ?? ""} />
              </div>
            </div>
            <div className="field">
              <label>Tags (separadas por vírgula)</label>
              <input name="tags" defaultValue={data?.tags.join(", ") ?? ""} placeholder="Urgente, Upsell..." />
            </div>
            <div className="field-row">
              <div className="field">
                <label>Pipeline</label>
                <select
                  name="pipelineId"
                  value={activePipelineId}
                  onChange={(e) => setPendingPipelineId(e.target.value)}
                >
                  {pipelines.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>Estágio</label>
                <select name="stageId" defaultValue={data?.stageId}>
                  {stages.map((s) => (
                    <option key={s.id} value={s.id}>{s.label}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="field-row">
              <div className="field">
                <label>Responsável</label>
                <select name="ownerId" defaultValue={data?.ownerId ?? team[0]?.id ?? ""}>
                  <option value="">Sem responsável</option>
                  {team.map((m) => (
                    <option key={m.id} value={m.id}>{m.name}</option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>Previsão de fechamento</label>
                <input name="expectedClose" type="date" defaultValue={data?.expectedClose?.slice(0, 10) ?? ""} />
              </div>
            </div>
            {lossReasons.length > 0 && (
              <div className="field">
                <label>Motivo de perda</label>
                <select name="lossReasonId" defaultValue={lossReasons.find((reason) => reason.name === data?.lossReason)?.id ?? ""}>
                  <option value="">Não se aplica / negócio em aberto</option>
                  {lossReasons.map((reason) => <option key={reason.id} value={reason.id}>{reason.name}</option>)}
                </select>
                <div className="field-help">Use ao marcar a oportunidade como perdida para manter o relatório comercial confiável.</div>
              </div>
            )}
            <CustomFieldInputs definitions={customFieldDefs} entity="OPPORTUNITY" values={data?.customFields ?? {}} />
          </div>
          <div className="modal-foot">
            {onDelete && (
              <button type="button" className="btn danger" onClick={onDelete} disabled={busy}>
                <Icon.trash /> Excluir
              </button>
            )}
            <div style={{ flex: 1 }} />
            <button type="button" className="btn" onClick={onClose}>Cancelar</button>
            <button type="submit" className="btn primary" disabled={busy}>
              {editing ? "Salvar" : "Criar oportunidade"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function PipelineNewModal({
  busy,
  onClose,
  onSubmit,
}: {
  busy: boolean;
  onClose: () => void;
  onSubmit: (name: string) => void;
}) {
  const [name, setName] = useState("");
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Novo pipeline</h2>
          <button className="close-x" onClick={onClose}><Icon.close /></button>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) onSubmit(name.trim());
          }}
        >
          <div className="modal-body">
            <div className="field">
              <label>Nome do pipeline *</label>
              <input
                required
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ex: Pós-venda, Suporte, Imóveis..."
              />
            </div>
            <div style={{ fontSize: 12, color: "var(--text-faint)" }}>
              Vai começar com as etapas padrão (Lead → Ganho/Perdido). Você pode editar depois em
              &quot;Gerenciar etapas&quot;.
            </div>
          </div>
          <div className="modal-foot">
            <button type="button" className="btn" onClick={onClose}>Cancelar</button>
            <button type="submit" className="btn primary" disabled={busy}>Criar pipeline</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function PipelineManageModal({
  pipeline,
  stageCounts,
  canDelete,
  busy,
  onClose,
  onRenamePipeline,
  onAddStage,
  onRenameStage,
  onSetColor,
  onMoveStage,
  onDeleteStage,
  onDeletePipeline,
}: {
  pipeline: PipelineDTO;
  stageCounts: Record<string, number>;
  canDelete: boolean;
  busy: boolean;
  onClose: () => void;
  onRenamePipeline: (name: string) => void;
  onAddStage: () => void;
  onRenameStage: (stageId: string, label: string) => void;
  onSetColor: (stageId: string, color: string) => void;
  onMoveStage: (stageId: string, dir: -1 | 1) => void;
  onDeleteStage: (stageId: string) => void;
  onDeletePipeline: () => void;
}) {
  const stages = [...pipeline.stages].sort((a, b) => a.order - b.order);
  const [openColorFor, setOpenColorFor] = useState<string | null>(null);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Gerenciar pipeline</h2>
          <button className="close-x" onClick={onClose}><Icon.close /></button>
        </div>
        <div className="modal-body">
          <div className="field">
            <label>Nome do pipeline</label>
            <input defaultValue={pipeline.name} onBlur={(e) => onRenamePipeline(e.target.value)} />
          </div>
          <div className="field">
            <label>Etapas</label>
            {stages.map((s, idx) => {
              const count = stageCounts[s.id] ?? 0;
              return (
                <div key={s.id} className="stage-row" style={{ position: "relative" }}>
                  <button
                    type="button"
                    className="color-dot"
                    style={{ background: s.color }}
                    onClick={() => setOpenColorFor(openColorFor === s.id ? null : s.id)}
                    title="Mudar cor"
                  />
                  {openColorFor === s.id && (
                    <div className="color-popover" onMouseLeave={() => setOpenColorFor(null)}>
                      {STAGE_COLORS.map((c) => (
                        <span
                          key={c}
                          className={`swatch ${s.color === c ? "selected" : ""}`}
                          style={{ background: c }}
                          onClick={() => {
                            onSetColor(s.id, c);
                            setOpenColorFor(null);
                          }}
                        />
                      ))}
                    </div>
                  )}
                  <input
                    type="text"
                    defaultValue={s.label}
                    onBlur={(e) => onRenameStage(s.id, e.target.value)}
                  />
                  <span className="muted" style={{ fontSize: 11, flexShrink: 0 }}>
                    {count} negócio{count === 1 ? "" : "s"}
                  </span>
                  <button
                    type="button"
                    className="icon-btn"
                    disabled={idx === 0 || busy}
                    onClick={() => onMoveStage(s.id, -1)}
                  >
                    <Icon.up />
                  </button>
                  <button
                    type="button"
                    className="icon-btn"
                    disabled={idx === stages.length - 1 || busy}
                    onClick={() => onMoveStage(s.id, 1)}
                  >
                    <Icon.down />
                  </button>
                  <button
                    type="button"
                    className="icon-btn danger"
                    disabled={stages.length <= 1 || busy}
                    onClick={() => {
                      if (count > 0 && !confirm(`Esta etapa tem ${count} negócio(s). Eles serão movidos para a primeira etapa restante. Continuar?`)) return;
                      onDeleteStage(s.id);
                    }}
                  >
                    <Icon.trash />
                  </button>
                </div>
              );
            })}
            <button type="button" className="add-stage-btn" onClick={onAddStage} disabled={busy}>
              <Icon.plus /> Adicionar etapa
            </button>
          </div>
        </div>
        <div className="modal-foot">
          <button
            type="button"
            className="btn danger"
            disabled={!canDelete || busy}
            title={canDelete ? "" : "Precisa existir pelo menos 1 pipeline"}
            onClick={() => {
              if (confirm("Excluir este pipeline e todas as oportunidades vinculadas a ele?")) onDeletePipeline();
            }}
          >
            <Icon.trash /> Excluir pipeline
          </button>
          <div style={{ flex: 1 }} />
          <button type="button" className="btn primary" onClick={onClose}>Concluir</button>
        </div>
      </div>
    </div>
  );
}
