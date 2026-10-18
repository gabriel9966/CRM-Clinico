"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Icon } from "@/components/icons";
import { initials } from "@/lib/format";
import type { TeamMemberDTO } from "@/lib/types";
import type { TaskCardDTO, TaskListDTO } from "@/lib/task-board";
import {
  createActivity,
  updateActivity,
  toggleActivityDone,
  deleteActivity,
  createTaskCard,
  moveActivity,
  createTaskList,
  renameTaskList,
  moveTaskList,
  deleteTaskList,
  fetchTaskBoard,
  fetchListCards,
  type ActivityInput,
} from "@/app/activities/actions";
import { EntityPicker } from "@/components/shared/EntityPicker";

const TYPE_LABEL: Record<TaskCardDTO["type"], string> = { TASK: "Tarefa", CALL: "Ligação", MEETING: "Reunião" };

function toLocalInputValue(iso: string) {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const fmtDue = (iso: string) =>
  new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

type CardModal = { data: TaskCardDTO | null; listId: string };

/** Move o cartão no estado local (antes da resposta do servidor), para o arrastar ser instantâneo. */
function moveLocal(lists: TaskListDTO[], cardId: string, toListId: string, beforeId: string | null): TaskListDTO[] {
  const card = lists.flatMap((l) => l.cards).find((c) => c.id === cardId);
  const target = lists.find((l) => l.id === toListId);
  if (!card || !target) return lists;
  const moved: TaskCardDTO = { ...card, listId: toListId, done: target.isDone, overdue: !target.isDone && card.overdue };
  return lists.map((l) => {
    const without = l.cards.filter((c) => c.id !== cardId);
    const hadIt = without.length !== l.cards.length;
    if (l.id !== toListId) return hadIt ? { ...l, cards: without, total: l.total - 1 } : l;
    const at = beforeId ? without.findIndex((c) => c.id === beforeId) : -1;
    const cards = [...without];
    cards.splice(at >= 0 ? at : cards.length, 0, moved);
    return { ...l, cards, total: hadIt ? l.total : l.total + 1 };
  });
}

export function ActivitiesView({ initialLists, team }: { initialLists: TaskListDTO[]; team: TeamMemberDTO[] }) {
  const router = useRouter();
  const [lists, setLists] = useState(initialLists);
  const [search, setSearch] = useState("");
  const [assignee, setAssignee] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modal, setModal] = useState<CardModal | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);
  const [adding, setAdding] = useState<string | null>(null); // id da coluna com o campo de novo cartão aberto
  const [draft, setDraft] = useState("");
  const [newList, setNewList] = useState<string | null>(null);
  const [menu, setMenu] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const requestId = useRef(0);
  const firstRun = useRef(true);
  const filter = { assigneeId: assignee || undefined, search: search.trim() || undefined };

  async function reload() {
    const mine = ++requestId.current;
    setLoading(true);
    try {
      const next = await fetchTaskBoard(filter);
      if (mine === requestId.current) {
        setLists(next);
        setError(null);
      }
    } catch {
      if (mine === requestId.current) setError("Não foi possível carregar as tarefas.");
    } finally {
      if (mine === requestId.current) setLoading(false);
    }
  }

  // Busca e responsável são consultas no servidor (com um pequeno atraso ao digitar).
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    const timer = setTimeout(() => void reload(), 250);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, assignee]);

  async function run(fn: () => Promise<unknown>, opts: { refresh?: boolean } = {}) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await reload();
      if (opts.refresh !== false) router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível concluir a ação.");
      await reload();
    } finally {
      setBusy(false);
    }
  }

  async function loadMore(list: TaskListDTO) {
    try {
      const page = await fetchListCards(list.id, list.cards.length, filter);
      setLists((prev) =>
        prev.map((l) => (l.id === list.id ? { ...l, cards: [...l.cards, ...page.cards.filter((c) => !l.cards.some((x) => x.id === c.id))], total: page.total } : l))
      );
    } catch {
      setError("Não foi possível carregar mais cartões.");
    }
  }

  function drop(toListId: string, beforeId: string | null) {
    const id = dragId;
    setDragId(null);
    setDragOver(null);
    if (!id || id === beforeId) return;
    setLists((prev) => moveLocal(prev, id, toListId, beforeId));
    void run(() => moveActivity(id, toListId, beforeId));
  }

  async function addCard(listId: string) {
    const title = draft.trim();
    if (!title) return;
    setDraft("");
    await run(() => createTaskCard(listId, title, assignee || null));
  }

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!modal) return;
    const fd = new FormData(e.currentTarget);
    const payload: ActivityInput = {
      title: String(fd.get("title") || ""),
      type: String(fd.get("type") || "TASK") as ActivityInput["type"],
      notes: String(fd.get("notes") || ""),
      dueAt: new Date(String(fd.get("dueAt") || "")).toISOString(),
      contactId: String(fd.get("contactId") || "") || null,
      opportunityId: String(fd.get("opportunityId") || "") || null,
      assigneeId: String(fd.get("assigneeId") || "") || null,
      listId: String(fd.get("listId") || "") || null,
    };
    const existing = modal.data;
    // Só muda de coluna na edição se o usuário escolheu outra.
    if (existing && payload.listId === (existing.listId ?? modal.listId)) payload.listId = undefined;
    try {
      await run(async () => {
        if (existing) await updateActivity(existing.id, payload);
        else await createActivity(payload);
      });
      setModal(null);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Não foi possível salvar.");
    }
  }

  const assigneeOf = (id: string | null) => (id ? team.find((m) => m.id === id) : undefined);

  return (
    <>
      <div className="topbar">
        <div>
          <h1>Tarefas</h1>
          <div className="sub">Quadro de tarefas: arraste os cartões entre as colunas — inclusive os criados por automações</div>
        </div>
        <button className="btn primary" onClick={() => setModal({ data: null, listId: lists.find((l) => !l.isDone)?.id ?? lists[0]?.id ?? "" })}>
          <Icon.plus /> Nova tarefa
        </button>
      </div>

      <div className="content">
        <div className="pipeline-bar" style={{ gap: 8 }}>
          <div className="search-bar" style={{ margin: 0, flex: 1, maxWidth: 320 }}>
            <Icon.search />
            <input placeholder="Buscar tarefa..." value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <select value={assignee} onChange={(e) => setAssignee(e.target.value)} style={{ maxWidth: 220 }}>
            <option value="">Todos os responsáveis</option>
            {team.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
          {loading && <span className="muted" style={{ fontSize: 12 }}>Atualizando…</span>}
        </div>
        {error && <p style={{ color: "var(--red)", fontSize: 13, fontWeight: 600, marginBottom: 10 }}>{error}</p>}

        <div className="kanban task-board" onClick={() => setMenu(null)}>
          {lists.map((list, index) => (
            <div key={list.id} className="kanban-col task-col">
              <div className="kanban-col-head">
                {renaming === list.id ? (
                  <input
                    autoFocus
                    defaultValue={list.name}
                    maxLength={80}
                    style={{ flex: 1, marginRight: 8 }}
                    onBlur={(e) => {
                      const name = e.target.value.trim();
                      setRenaming(null);
                      if (name && name !== list.name) void run(() => renameTaskList(list.id, name), { refresh: false });
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                      if (e.key === "Escape") setRenaming(null);
                    }}
                  />
                ) : (
                  <div className="title" onDoubleClick={() => setRenaming(list.id)} title="Duplo clique para renomear">
                    <span className="pip" style={{ background: list.isDone ? "var(--green)" : "var(--text-faint)" }} />
                    {list.name}
                    <span className="count">{list.total}</span>
                  </div>
                )}
                <div style={{ position: "relative" }}>
                  <button
                    className="btn small ghost"
                    aria-label={`Opções da coluna ${list.name}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      setMenu(menu === list.id ? null : list.id);
                    }}
                  >
                    ⋯
                  </button>
                  {menu === list.id && (
                    <div className="task-menu" onClick={(e) => e.stopPropagation()}>
                      <button onClick={() => { setMenu(null); setRenaming(list.id); }}>Renomear</button>
                      <button disabled={index === 0} onClick={() => { setMenu(null); void run(() => moveTaskList(list.id, -1), { refresh: false }); }}>Mover para a esquerda</button>
                      <button disabled={index === lists.length - 1} onClick={() => { setMenu(null); void run(() => moveTaskList(list.id, 1), { refresh: false }); }}>Mover para a direita</button>
                      <button
                        className="danger"
                        onClick={() => {
                          setMenu(null);
                          if (confirm(`Excluir a coluna "${list.name}"? Os cartões vão para outra coluna.`)) void run(() => deleteTaskList(list.id));
                        }}
                      >
                        Excluir coluna
                      </button>
                    </div>
                  )}
                </div>
              </div>

              <div
                className={`kanban-cards ${dragOver === list.id ? "drag-over" : ""}`}
                onDragOver={(e) => { if (dragId) { e.preventDefault(); setDragOver(list.id); } }}
                onDragLeave={() => setDragOver((cur) => (cur === list.id ? null : cur))}
                onDrop={(e) => { e.preventDefault(); drop(list.id, null); }}
              >
                {list.cards.map((card) => {
                  const who = assigneeOf(card.assigneeId);
                  return (
                    <div
                      key={card.id}
                      className={`deal-card task-card ${dragId === card.id ? "dragging" : ""} ${card.done ? "done" : ""}`}
                      draggable
                      onDragStart={(e) => { e.dataTransfer.effectAllowed = "move"; setDragId(card.id); }}
                      onDragEnd={() => { setDragId(null); setDragOver(null); }}
                      onDrop={(e) => { e.preventDefault(); e.stopPropagation(); drop(list.id, card.id); }}
                      onClick={() => setModal({ data: card, listId: list.id })}
                    >
                      <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                        <div
                          className={`activity-check ${card.done ? "checked" : ""}`}
                          role="checkbox"
                          aria-checked={card.done}
                          aria-label={card.done ? "Reabrir tarefa" : "Concluir tarefa"}
                          onClick={(e) => { e.stopPropagation(); void run(() => toggleActivityDone(card.id, !card.done)); }}
                        >
                          {card.done && "✓"}
                        </div>
                        <div className={`title ${card.done ? "strike" : ""}`} style={{ marginBottom: 0, flex: 1 }}>{card.title}</div>
                      </div>
                      {(card.contactName || card.opportunityTitle) && (
                        <div className="contact-row" style={{ marginTop: 6 }}>
                          {card.contactName && <span>{card.contactName}</span>}
                          {card.opportunityTitle && <span>· {card.opportunityTitle}</span>}
                        </div>
                      )}
                      <div className="deal-card-footer">
                        <span className={`task-due ${card.overdue ? "overdue" : ""}`}>
                          {TYPE_LABEL[card.type]} · {fmtDue(card.dueAt)}{card.overdue ? " · atrasada" : ""}
                        </span>
                        {who && (
                          <span className="avatar" title={who.name} style={{ width: 20, height: 20, fontSize: 9, background: who.color }}>
                            {initials(who.name)}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
                {list.cards.length < list.total && (
                  <button className="btn small ghost" onClick={() => void loadMore(list)}>
                    Carregar mais ({list.total - list.cards.length})
                  </button>
                )}
              </div>

              <div className="task-add">
                {adding === list.id ? (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      void addCard(list.id);
                    }}
                  >
                    <textarea
                      autoFocus
                      rows={2}
                      maxLength={200}
                      value={draft}
                      placeholder="Título do cartão…"
                      onChange={(e) => setDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          void addCard(list.id);
                        }
                        if (e.key === "Escape") { setAdding(null); setDraft(""); }
                      }}
                    />
                    <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                      <button type="submit" className="btn small primary" disabled={busy || !draft.trim()}>Adicionar</button>
                      <button type="button" className="btn small ghost" onClick={() => { setAdding(null); setDraft(""); }}>Cancelar</button>
                    </div>
                  </form>
                ) : (
                  <button className="btn small ghost" style={{ width: "100%", justifyContent: "flex-start" }} onClick={() => { setAdding(list.id); setDraft(""); }}>
                    <Icon.plus /> Adicionar cartão
                  </button>
                )}
              </div>
            </div>
          ))}

          <div className="kanban-col task-col task-new-list">
            {newList === null ? (
              <button className="btn small ghost" style={{ width: "100%", justifyContent: "flex-start" }} onClick={() => setNewList("")}>
                <Icon.plus /> Adicionar coluna
              </button>
            ) : (
              <form
                style={{ padding: 10 }}
                onSubmit={(e) => {
                  e.preventDefault();
                  const name = newList.trim();
                  setNewList(null);
                  if (name) void run(() => createTaskList(name), { refresh: false });
                }}
              >
                <input autoFocus maxLength={80} value={newList} placeholder="Nome da coluna" onChange={(e) => setNewList(e.target.value)} onKeyDown={(e) => { if (e.key === "Escape") setNewList(null); }} />
                <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                  <button type="submit" className="btn small primary" disabled={!newList.trim()}>Criar coluna</button>
                  <button type="button" className="btn small ghost" onClick={() => setNewList(null)}>Cancelar</button>
                </div>
              </form>
            )}
          </div>
        </div>
      </div>

      {modal && (
        <div className="modal-overlay" onClick={() => setModal(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h2>{modal.data ? "Editar tarefa" : "Nova tarefa"}</h2>
              <button className="close-x" onClick={() => setModal(null)}><Icon.close /></button>
            </div>
            <form onSubmit={submit}>
              <div className="modal-body">
                <div className="field">
                  <label>Título *</label>
                  <input name="title" required defaultValue={modal.data?.title} placeholder="Ex: Ligar para follow-up" />
                </div>
                <div className="field-row">
                  <div className="field">
                    <label>Coluna</label>
                    <select name="listId" defaultValue={modal.data?.listId ?? modal.listId}>
                      {lists.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                    </select>
                  </div>
                  <div className="field">
                    <label>Tipo</label>
                    <select name="type" defaultValue={modal.data?.type ?? "TASK"}>
                      <option value="TASK">Tarefa</option>
                      <option value="CALL">Ligação</option>
                      <option value="MEETING">Reunião</option>
                    </select>
                  </div>
                </div>
                <div className="field-row">
                  <div className="field">
                    <label>Vencimento *</label>
                    <input
                      name="dueAt"
                      type="datetime-local"
                      required
                      defaultValue={modal.data ? toLocalInputValue(modal.data.dueAt) : toLocalInputValue(new Date().toISOString())}
                    />
                  </div>
                  <div className="field">
                    <label>Responsável</label>
                    <select name="assigneeId" defaultValue={modal.data?.assigneeId ?? ""}>
                      <option value="">Sem responsável</option>
                      {team.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                    </select>
                  </div>
                </div>
                <div className="field-row">
                  <div className="field">
                    <label>Contato</label>
                    <EntityPicker
                      name="contactId"
                      kind="contact"
                      allowEmpty
                      initial={modal.data?.contactId ? { id: modal.data.contactId, label: modal.data.contactName ?? "Contato" } : null}
                    />
                  </div>
                  <div className="field">
                    <label>Oportunidade</label>
                    <EntityPicker
                      name="opportunityId"
                      kind="opportunity"
                      allowEmpty
                      initial={
                        modal.data?.opportunityId
                          ? { id: modal.data.opportunityId, label: modal.data.opportunityTitle ?? "Oportunidade" }
                          : null
                      }
                    />
                  </div>
                </div>
                <div className="field">
                  <label>Notas</label>
                  <textarea name="notes" defaultValue={modal.data?.notes ?? ""} />
                </div>
              </div>
              <div className="modal-foot">
                {modal.data && (
                  <button
                    type="button"
                    className="btn danger"
                    disabled={busy}
                    onClick={() => run(() => deleteActivity(modal.data!.id)).then(() => setModal(null))}
                  >
                    <Icon.trash /> Excluir
                  </button>
                )}
                <div style={{ flex: 1 }} />
                <button type="button" className="btn" onClick={() => setModal(null)}>Cancelar</button>
                <button type="submit" className="btn primary" disabled={busy}>{modal.data ? "Salvar" : "Criar tarefa"}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
