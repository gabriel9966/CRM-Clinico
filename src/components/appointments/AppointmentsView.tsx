"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Icon } from "@/components/icons";
import { initials } from "@/lib/format";
import type { AppointmentDTO, AppointmentRowDTO, Page, TeamMemberDTO } from "@/lib/types";
import {
  createAppointment,
  updateAppointment,
  setAppointmentStatus,
  deleteAppointment,
  disconnectGoogle,
  type AppointmentInput,
} from "@/app/appointments/actions";
import { fetchAppointments } from "@/app/listings/actions";
import { EntityPicker } from "@/components/shared/EntityPicker";

type Range = "upcoming" | "past";

const STATUS_LABEL: Record<AppointmentDTO["status"], string> = {
  SCHEDULED: "Agendado",
  CONFIRMED: "Confirmado",
  CANCELLED: "Cancelado",
  COMPLETED: "Concluído",
  NO_SHOW: "Faltou",
};
const STATUS_COLOR: Record<AppointmentDTO["status"], string> = {
  SCHEDULED: "var(--orange)",
  CONFIRMED: "var(--green)",
  CANCELLED: "var(--red)",
  COMPLETED: "var(--text-faint)",
  NO_SHOW: "var(--red)",
};

function toLocalInputValue(iso: string) {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function dayKey(iso: string) {
  return new Date(iso).toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long" });
}

export function AppointmentsView({
  initialPage,
  team,
  currentUserId,
  googleConnectedUserIds,
}: {
  /** Primeira página dos agendamentos próximos (a partir de ontem). */
  initialPage: Page<AppointmentRowDTO>;
  team: TeamMemberDTO[];
  currentUserId: string;
  googleConnectedUserIds: string[];
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [range, setRange] = useState<Range>("upcoming");
  const [appointments, setAppointments] = useState<AppointmentRowDTO[]>(initialPage.items);
  const [nextCursor, setNextCursor] = useState<string | null>(initialPage.nextCursor);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [modal, setModal] = useState<null | { data: AppointmentRowDTO | null }>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const requestId = useRef(0);
  const firstRun = useRef(true);

  // "Próximos" e "Anteriores" são consultas separadas no servidor, paginadas.
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    const mine = ++requestId.current;
    // setTimeout(0): o estado de "carregando" é aplicado fora do corpo síncrono
    // do efeito, e trocas rápidas de aba cancelam a busca anterior.
    const timer = setTimeout(async () => {
      setLoading(true);
      setLoadError(null);
      try {
        const page = await fetchAppointments(range);
        if (mine !== requestId.current) return;
        setAppointments(page.items);
        setNextCursor(page.nextCursor);
      } catch {
        if (mine === requestId.current) setLoadError("Não foi possível carregar os agendamentos.");
      } finally {
        if (mine === requestId.current) setLoading(false);
      }
    }, 0);
    return () => clearTimeout(timer);
  }, [range, reloadKey]);

  async function loadMore() {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    const mine = requestId.current;
    try {
      const page = await fetchAppointments(range, nextCursor);
      if (mine !== requestId.current) return;
      setAppointments((prev) => [...prev, ...page.items]);
      setNextCursor(page.nextCursor);
    } catch {
      setLoadError("Não foi possível carregar mais agendamentos.");
    } finally {
      setLoadingMore(false);
    }
  }

  const isConnected = googleConnectedUserIds.includes(currentUserId);

  useEffect(() => {
    if (searchParams.get("connected")) setNotice("Google Calendar conectado com sucesso!");
    else if (searchParams.get("error") === "google_not_configured") setNotice("O administrador ainda não configurou as credenciais do Google (GOOGLE_CLIENT_ID/SECRET no .env).");
    else if (searchParams.get("error") === "google_no_refresh_token") setNotice("O Google não enviou permissão de acesso contínuo. Revogue o acesso em myaccount.google.com/permissions e tente conectar de novo.");
    else if (searchParams.get("error")) setNotice("Não foi possível conectar ao Google. Tente novamente.");
  }, [searchParams]);

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

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!modal) return;
    const fd = new FormData(e.currentTarget);
    const date = String(fd.get("date") || "");
    const startTime = String(fd.get("startTime") || "");
    const endTime = String(fd.get("endTime") || "");
    const payload: AppointmentInput = {
      title: String(fd.get("title") || ""),
      notes: String(fd.get("notes") || ""),
      startAt: new Date(`${date}T${startTime}`).toISOString(),
      endAt: new Date(`${date}T${endTime}`).toISOString(),
      contactId: String(fd.get("contactId") || "") || null,
      ownerId: String(fd.get("ownerId") || "") || null,
    };
    const existing = modal.data;
    await run(async () => {
      if (existing) await updateAppointment(existing.id, payload);
      else await createAppointment(payload);
    });
    setModal(null);
  }

  const groups = new Map<string, AppointmentRowDTO[]>();
  for (const a of appointments) {
    const key = dayKey(a.startAt);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(a);
  }

  function ownerOf(id: string | null) {
    return id ? team.find((m) => m.id === id) : undefined;
  }

  return (
    <>
      <div className="topbar">
        <div>
          <h1>Agendamentos</h1>
          <div className="sub">Reuniões com leads, sincronizadas com o Google Calendar</div>
        </div>
        <button className="btn primary" onClick={() => setModal({ data: null })}>
          <Icon.plus /> Novo agendamento
        </button>
      </div>

      <div className="content">
        {notice && (
          <div className="gcal-banner connected" style={{ marginBottom: 16 }}>
            {notice}
            <div style={{ flex: 1 }} />
            <button className="btn small ghost" onClick={() => setNotice(null)}>Fechar</button>
          </div>
        )}

        <div className={`gcal-banner ${isConnected ? "connected" : ""}`}>
          <Icon.calendar />
          {isConnected ? (
            <>
              Seu Google Calendar está conectado — novos agendamentos seus entram lá automaticamente.
              <div style={{ flex: 1 }} />
              <button className="btn small" onClick={() => run(() => disconnectGoogle(currentUserId))} disabled={busy}>Desconectar</button>
            </>
          ) : (
            <>
              Conecte seu Google Calendar pra sincronizar os agendamentos automaticamente.
              <div style={{ flex: 1 }} />
              <a className="btn primary small" href="/api/google/connect">Conectar Google Calendar</a>
            </>
          )}
        </div>

        <div className="pipeline-bar">
          {(["upcoming", "past"] as const).map((r) => (
            <div key={r} className={`pipeline-tab ${range === r ? "active" : ""}`} onClick={() => setRange(r)}>
              {r === "upcoming" ? "Próximos" : "Anteriores"}
            </div>
          ))}
          {loading && <span className="muted" style={{ fontSize: 12 }}>Atualizando…</span>}
        </div>
        {loadError && <p style={{ color: "var(--red)", fontSize: 13, fontWeight: 600, marginBottom: 10 }}>{loadError}</p>}

        {appointments.length === 0 ? (
          <div className="empty-state"><Icon.calendar /><div>{loading ? "Carregando…" : "Nenhum agendamento aqui"}</div></div>
        ) : (
          [...groups.entries()].map(([day, items]) => (
            <div key={day} className="day-group">
              <div className="day-group-label">{day}</div>
              {items.map((a) => {
                const contactName = a.contactName;
                const owner = ownerOf(a.ownerId);
                return (
                  <div key={a.id} className={`appt-row ${a.status === "CANCELLED" ? "cancelled" : ""}`} onClick={() => setModal({ data: a })}>
                    <div className="appt-time">
                      {new Date(a.startAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                      <span className="end">{new Date(a.endAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</span>
                    </div>
                    <div className="appt-main">
                      <div className="appt-title">{a.title}</div>
                      <div className="appt-meta">
                        {contactName && <span>{contactName}</span>}
                        {owner && (
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                            <span className="avatar" style={{ width: 16, height: 16, fontSize: 8, background: owner.color }}>{initials(owner.name)}</span>
                            {owner.name}
                          </span>
                        )}
                        {a.googleEventId && <span className="google-badge"><Icon.calendar style={{ width: 11, height: 11 }} /> Google</span>}
                        <span className="pill" style={{ background: STATUS_COLOR[a.status] + "22", color: STATUS_COLOR[a.status] }}>{STATUS_LABEL[a.status]}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ))
        )}

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
              <h2>{modal.data ? "Editar agendamento" : "Novo agendamento"}</h2>
              <button className="close-x" onClick={() => setModal(null)}><Icon.close /></button>
            </div>
            <form onSubmit={submit}>
              <div className="modal-body">
                <div className="field">
                  <label>Título *</label>
                  <input name="title" required defaultValue={modal.data?.title} placeholder="Ex: Reunião de apresentação" />
                </div>
                <div className="field-row">
                  <div className="field">
                    <label>Data *</label>
                    <input name="date" type="date" required defaultValue={toLocalInputValue(modal.data ? modal.data.startAt : new Date().toISOString()).slice(0, 10)} />
                  </div>
                  <div className="field">
                    <label>Início *</label>
                    <input name="startTime" type="time" required defaultValue={modal.data ? toLocalInputValue(modal.data.startAt).slice(11) : "09:00"} />
                  </div>
                  <div className="field">
                    <label>Fim *</label>
                    <input name="endTime" type="time" required defaultValue={modal.data ? toLocalInputValue(modal.data.endAt).slice(11) : "09:30"} />
                  </div>
                </div>
                <div className="field-row">
                  <div className="field">
                    <label>Contato / Lead</label>
                    <EntityPicker
                      name="contactId"
                      kind="contact"
                      allowEmpty
                      initial={modal.data?.contactId ? { id: modal.data.contactId, label: modal.data.contactName ?? "Contato" } : null}
                    />
                  </div>
                  <div className="field">
                    <label>Atendente (calendário)</label>
                    <select name="ownerId" defaultValue={modal.data?.ownerId ?? currentUserId}>
                      <option value="">Sem responsável</option>
                      {team.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name}{googleConnectedUserIds.includes(m.id) ? " (Google conectado)" : ""}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                {modal.data && (
                  <div className="field">
                    <label>Status</label>
                    <select
                      defaultValue={modal.data.status}
                      onChange={(e) => run(() => setAppointmentStatus(modal.data!.id, e.target.value as AppointmentDTO["status"]))}
                    >
                      {Object.entries(STATUS_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </select>
                  </div>
                )}
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
                    onClick={() => run(() => deleteAppointment(modal.data!.id)).then(() => setModal(null))}
                  >
                    <Icon.trash /> Excluir
                  </button>
                )}
                <div style={{ flex: 1 }} />
                <button type="button" className="btn" onClick={() => setModal(null)}>Cancelar</button>
                <button type="submit" className="btn primary" disabled={busy}>{modal.data ? "Salvar" : "Criar agendamento"}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
