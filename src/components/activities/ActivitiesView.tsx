"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Icon } from "@/components/icons";
import { initials } from "@/lib/format";
import type { ActivityRowDTO, Page, TeamMemberDTO } from "@/lib/types";
import { createActivity, updateActivity, toggleActivityDone, deleteActivity, type ActivityInput } from "@/app/activities/actions";
import { fetchActivities } from "@/app/listings/actions";
import { EntityPicker } from "@/components/shared/EntityPicker";

const TYPE_LABEL: Record<ActivityRowDTO["type"], string> = { TASK: "Tarefa", CALL: "Ligação", MEETING: "Reunião" };

type Filter = "pending" | "done" | "all";

function toLocalInputValue(iso: string) {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function ActivitiesView({
  initialPage,
  team,
}: {
  /** Primeira página das tarefas pendentes (o filtro padrão). */
  initialPage: Page<ActivityRowDTO>;
  team: TeamMemberDTO[];
}) {
  const router = useRouter();
  const [filter, setFilter] = useState<Filter>("pending");
  const [rows, setRows] = useState<ActivityRowDTO[]>(initialPage.items);
  const [nextCursor, setNextCursor] = useState<string | null>(initialPage.nextCursor);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [modal, setModal] = useState<null | { data: ActivityRowDTO | null }>(null);
  const [busy, setBusy] = useState(false);
  const requestId = useRef(0);
  const firstRun = useRef(true);

  // Cada filtro é uma consulta no servidor (paginada), não um filtro em memória.
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    const mine = ++requestId.current;
    const timer = setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const page = await fetchActivities(filter);
        if (mine !== requestId.current) return;
        setRows(page.items);
        setNextCursor(page.nextCursor);
      } catch {
        if (mine === requestId.current) setError("Não foi possível carregar as tarefas.");
      } finally {
        if (mine === requestId.current) setLoading(false);
      }
    }, 0);
    return () => clearTimeout(timer);
  }, [filter, reloadKey]);

  async function loadMore() {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    const mine = requestId.current;
    try {
      const page = await fetchActivities(filter, nextCursor);
      if (mine !== requestId.current) return;
      setRows((prev) => [...prev, ...page.items]);
      setNextCursor(page.nextCursor);
    } catch {
      setError("Não foi possível carregar mais tarefas.");
    } finally {
      setLoadingMore(false);
    }
  }

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    try {
      await fn();
      setReloadKey((k) => k + 1);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  function assigneeOf(id: string | null) {
    return id ? team.find((m) => m.id === id) : undefined;
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
    };
    const existing = modal.data;
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

  return (
    <>
      <div className="topbar">
        <div>
          <h1>Tarefas</h1>
          <div className="sub">Follow-ups, ligações e reuniões — inclusive as criadas por automações</div>
        </div>
        <button className="btn primary" onClick={() => setModal({ data: null })}>
          <Icon.plus /> Nova tarefa
        </button>
      </div>

      <div className="content">
        <div className="pipeline-bar">
          {(["pending", "done", "all"] as const).map((f) => (
            <div key={f} className={`pipeline-tab ${filter === f ? "active" : ""}`} onClick={() => setFilter(f)}>
              {f === "pending" ? "Pendentes" : f === "done" ? "Concluídas" : "Todas"}
            </div>
          ))}
          {loading && <span className="muted" style={{ fontSize: 12 }}>Atualizando…</span>}
        </div>
        {error && <p style={{ color: "var(--red)", fontSize: 13, fontWeight: 600, marginBottom: 10 }}>{error}</p>}

        <div className="table-wrap" style={{ opacity: loading ? 0.6 : 1, transition: "opacity .15s" }}>
          {rows.length === 0 ? (
            <div className="empty-state"><Icon.tasks /><div>{loading ? "Carregando…" : "Nenhuma tarefa por aqui"}</div></div>
          ) : (
            rows.map((a) => {
              const overdue = a.overdue; // calculado no servidor no momento da consulta
              const assignee = assigneeOf(a.assigneeId);
              return (
                <div key={a.id} className={`activity-row ${a.done ? "done" : ""}`}>
                  <div
                    className={`activity-check ${a.done ? "checked" : ""}`}
                    onClick={() => run(() => toggleActivityDone(a.id, !a.done))}
                  >
                    {a.done && "✓"}
                  </div>
                  <div style={{ flex: 1, minWidth: 0, cursor: "pointer" }} onClick={() => setModal({ data: a })}>
                    <div className={`activity-title ${a.done ? "strike" : ""}`}>{a.title}</div>
                    <div className={`activity-meta ${overdue ? "overdue" : ""}`}>
                      <span>{TYPE_LABEL[a.type]}</span>
                      <span>{new Date(a.dueAt).toLocaleString("pt-BR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}{overdue ? " · atrasada" : ""}</span>
                      {a.contactName && <span>Contato: {a.contactName}</span>}
                      {a.opportunityTitle && <span>Oportunidade: {a.opportunityTitle}</span>}
                      {assignee && (
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                          <span className="avatar" style={{ width: 16, height: 16, fontSize: 8, background: assignee.color }}>{initials(assignee.name)}</span>
                          {assignee.name}
                        </span>
                      )}
                    </div>
                  </div>
                  <button className="btn small ghost" onClick={() => run(() => deleteActivity(a.id))} disabled={busy}>
                    <Icon.trash />
                  </button>
                </div>
              );
            })
          )}
        </div>

        {nextCursor && (
          <div style={{ textAlign: "center", marginTop: 14 }}>
            <button className="btn" onClick={loadMore} disabled={loadingMore}>
              {loadingMore ? "Carregando…" : "Carregar mais"}
            </button>
          </div>
        )}
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
                    <label>Tipo</label>
                    <select name="type" defaultValue={modal.data?.type ?? "TASK"}>
                      <option value="TASK">Tarefa</option>
                      <option value="CALL">Ligação</option>
                      <option value="MEETING">Reunião</option>
                    </select>
                  </div>
                  <div className="field">
                    <label>Vencimento *</label>
                    <input
                      name="dueAt"
                      type="datetime-local"
                      required
                      defaultValue={modal.data ? toLocalInputValue(modal.data.dueAt) : toLocalInputValue(new Date().toISOString())}
                    />
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
                  <label>Responsável</label>
                  <select name="assigneeId" defaultValue={modal.data?.assigneeId ?? ""}>
                    <option value="">Sem responsável</option>
                    {team.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                  </select>
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
