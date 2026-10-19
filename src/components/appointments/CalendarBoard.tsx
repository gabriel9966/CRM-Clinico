"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { fetchCalendarRange } from "@/app/listings/actions";
import type { AppointmentDTO, AppointmentRowDTO, GoogleEventDTO, TeamMemberDTO } from "@/lib/types";

// Visões de calendário da agenda (dia / semana / mês). Mostra os agendamentos
// do CRM e, por cima, os eventos com horário das agendas Google conectadas
// (somente leitura). No dia, cada atendente é uma coluna, como no quadro de
// closers do agenda-silva: horário livre é clicável para agendar.

export type CalendarView = "day" | "week" | "month";

const HOUR_PX = 52;
const DEFAULT_START_HOUR = 7;
const DEFAULT_END_HOUR = 21;
const POLL_MS = 5 * 60_000;
const UNASSIGNED = "__none__";

const STATUS_COLOR: Record<AppointmentDTO["status"], string> = {
  SCHEDULED: "var(--orange)",
  CONFIRMED: "var(--green)",
  CANCELLED: "var(--red)",
  COMPLETED: "var(--text-faint)",
  NO_SHOW: "var(--red)",
};

type Item =
  | { kind: "crm"; id: string; ownerId: string | null; start: Date; end: Date; title: string; sub: string | null; color: string; cancelled: boolean; data: AppointmentRowDTO }
  | { kind: "google"; id: string; ownerId: string; start: Date; end: Date; title: string; sub: string | null; color: string; cancelled: false; link: string | null };

function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function addDays(d: Date, n: number) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
function startOfWeek(d: Date) {
  const x = startOfDay(d);
  return addDays(x, -((x.getDay() + 6) % 7));
}
function sameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
function hhmm(d: Date) {
  return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}
function ymd(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function rangeFor(view: CalendarView, anchor: Date): { from: Date; to: Date; days: Date[] } {
  if (view === "day") {
    const from = startOfDay(anchor);
    return { from, to: addDays(from, 1), days: [from] };
  }
  if (view === "week") {
    const from = startOfWeek(anchor);
    return { from, to: addDays(from, 7), days: Array.from({ length: 7 }, (_, i) => addDays(from, i)) };
  }
  const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const from = startOfWeek(first);
  return { from, to: addDays(from, 42), days: Array.from({ length: 42 }, (_, i) => addDays(from, i)) };
}

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function title(view: CalendarView, anchor: Date, days: Date[]) {
  if (view === "day") return capitalize(anchor.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long", year: "numeric" }));
  if (view === "month") return capitalize(anchor.toLocaleDateString("pt-BR", { month: "long", year: "numeric" }));
  const a = days[0];
  const b = days[6];
  return `${a.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })} – ${b.toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" })}`;
}

// Distribui eventos sobrepostos em faixas lado a lado.
function layout(items: Item[]) {
  const sorted = [...items].sort((a, b) => a.start.getTime() - b.start.getTime() || b.end.getTime() - a.end.getTime());
  const out: { item: Item; lane: number; lanes: number }[] = [];
  let cluster: { item: Item; lane: number }[] = [];
  let laneEnds: number[] = [];
  let clusterEnd = 0;
  const flush = () => {
    const lanes = Math.max(1, laneEnds.length);
    for (const c of cluster) out.push({ ...c, lanes });
    cluster = [];
    laneEnds = [];
  };
  for (const item of sorted) {
    if (cluster.length && item.start.getTime() >= clusterEnd) flush();
    let lane = laneEnds.findIndex((end) => end <= item.start.getTime());
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(0);
    }
    laneEnds[lane] = item.end.getTime();
    clusterEnd = Math.max(clusterEnd, item.end.getTime());
    cluster.push({ item, lane });
  }
  flush();
  return out;
}

export function CalendarBoard({
  view,
  team,
  currentUserId,
  reloadKey,
  onOpenAppointment,
  onCreateAt,
}: {
  view: CalendarView;
  team: TeamMemberDTO[];
  currentUserId: string;
  /** Muda quando um agendamento é criado/alterado, para recarregar. */
  reloadKey: number;
  onOpenAppointment: (a: AppointmentRowDTO) => void;
  onCreateAt: (preset: { date: string; startTime: string; ownerId: string | null }) => void;
}) {
  const [anchor, setAnchor] = useState(() => startOfDay(new Date()));
  const [data, setData] = useState<{ appointments: AppointmentRowDTO[]; googleEvents: GoogleEventDTO[]; googleErrorUserIds: string[] } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  // "Agora" só existe no navegador: o servidor roda em outro fuso e a hora
  // muda entre o SSR e a hidratação. Até montar, mostra só o esqueleto.
  const [now, setNow] = useState<Date | null>(null);
  const requestId = useRef(0);

  const { from, to, days } = useMemo(() => rangeFor(view, anchor), [view, anchor]);

  useEffect(() => {
    const mine = ++requestId.current;
    const timer = setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const result = await fetchCalendarRange(from.toISOString(), to.toISOString());
        if (mine === requestId.current) setData(result);
      } catch {
        if (mine === requestId.current) setError("Não foi possível carregar a agenda.");
      } finally {
        if (mine === requestId.current) setLoading(false);
      }
    }, 0);
    return () => clearTimeout(timer);
  }, [from, to, reloadKey, tick]);

  // Agenda Google muda fora do CRM: relê a cada 5 minutos.
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), POLL_MS);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const first = setTimeout(() => {
      setNow(new Date());
      setAnchor(startOfDay(new Date()));
    }, 0);
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, []);

  const colorOf = useMemo(() => new Map(team.map((m) => [m.id, m.color])), [team]);
  const nameOf = useMemo(() => new Map(team.map((m) => [m.id, m.name])), [team]);

  const items: Item[] = useMemo(() => {
    if (!data) return [];
    const crm: Item[] = data.appointments.map((a) => ({
      kind: "crm",
      id: a.id,
      ownerId: a.ownerId,
      start: new Date(a.startAt),
      end: new Date(a.endAt),
      title: a.title,
      sub: a.contactName ?? (a.ownerId ? nameOf.get(a.ownerId) ?? null : null),
      color: STATUS_COLOR[a.status],
      cancelled: a.status === "CANCELLED",
      data: a,
    }));
    const google: Item[] = data.googleEvents.map((e) => ({
      kind: "google",
      id: `g:${e.ownerId}:${e.id}`,
      ownerId: e.ownerId,
      start: new Date(e.startAt),
      end: new Date(e.endAt),
      title: e.title,
      sub: e.ownerId === currentUserId ? "Google Agenda" : nameOf.get(e.ownerId) ?? null,
      color: "var(--blue)",
      cancelled: false,
      link: e.htmlLink,
    }));
    return [...crm, ...google];
  }, [data, nameOf, currentUserId]);

  // Na semana e no mês, da agenda Google só os eventos do próprio usuário.
  const visibleItems = view === "day" ? items : items.filter((i) => i.kind === "crm" || i.ownerId === currentUserId);

  function move(step: number) {
    if (view === "day") setAnchor((a) => addDays(a, step));
    else if (view === "week") setAnchor((a) => addDays(a, step * 7));
    else setAnchor((a) => new Date(a.getFullYear(), a.getMonth() + step, 1));
  }

  function openItem(item: Item) {
    if (item.kind === "crm") onOpenAppointment(item.data);
    else if (item.link) window.open(item.link, "_blank", "noopener,noreferrer");
  }

  // Faixa de horas: padrão comercial, ampliada se houver evento fora dela.
  const [startHour, endHour] = useMemo(() => {
    let s = DEFAULT_START_HOUR;
    let e = DEFAULT_END_HOUR;
    for (const i of visibleItems) {
      if (i.start < from || i.start >= to) continue;
      s = Math.min(s, i.start.getHours());
      e = Math.max(e, sameDay(i.start, i.end) ? Math.ceil(i.end.getHours() + i.end.getMinutes() / 60) : 24);
    }
    return [s, Math.min(24, e)];
  }, [visibleItems, from, to]);
  const hours = Array.from({ length: endHour - startHour }, (_, i) => startHour + i);

  const errorNames = (data?.googleErrorUserIds ?? []).map((id) => nameOf.get(id) ?? "um atendente");

  function timeGrid(columns: { key: string; label: React.ReactNode; day: Date; ownerId: string | null; today?: boolean }[]) {
    if (!now) return null;
    return (
      <div className="cal-grid-wrap">
        <div className="cal-grid" style={{ gridTemplateColumns: `56px repeat(${columns.length}, minmax(140px, 1fr))` }}>
          <div className="cal-corner" />
          {columns.map((c) => (
            <div key={c.key} className={`cal-col-head ${c.today ? "today" : ""}`}>{c.label}</div>
          ))}
          <div className="cal-hours">
            {hours.map((h) => (
              <div key={h} className="cal-hour-label" style={{ height: HOUR_PX }}>{String(h).padStart(2, "0")}:00</div>
            ))}
          </div>
          {columns.map((c) => {
            const dayStart = startOfDay(c.day);
            const colItems = visibleItems.filter((i) => {
              if (!sameDay(i.start, c.day)) return false;
              if (view !== "day") return true;
              return (i.ownerId ?? UNASSIGNED) === (c.ownerId ?? UNASSIGNED);
            });
            return (
              <div key={c.key} className="cal-col" style={{ height: hours.length * HOUR_PX }}>
                {hours.map((h) => (
                  <button
                    key={h}
                    type="button"
                    className="cal-slot"
                    style={{ height: HOUR_PX }}
                    title={`Agendar às ${String(h).padStart(2, "0")}:00`}
                    onClick={() => onCreateAt({ date: ymd(c.day), startTime: `${String(h).padStart(2, "0")}:00`, ownerId: c.ownerId })}
                  />
                ))}
                {sameDay(now, c.day) && now.getHours() >= startHour && now.getHours() < endHour && (
                  <div className="cal-now" style={{ top: ((now.getTime() - dayStart.getTime()) / 3_600_000 - startHour) * HOUR_PX }} />
                )}
                {layout(colItems).map(({ item, lane, lanes }) => {
                  const startH = (item.start.getTime() - dayStart.getTime()) / 3_600_000;
                  const endH = Math.min(24, (item.end.getTime() - dayStart.getTime()) / 3_600_000);
                  const top = (startH - startHour) * HOUR_PX;
                  const height = Math.max(22, (endH - startH) * HOUR_PX - 2);
                  // Blocos curtos (até ~40 min): hora e título na mesma linha.
                  const compact = height < 36;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      className={`cal-event ${item.kind} ${item.cancelled ? "cancelled" : ""} ${compact ? "compact" : ""}`}
                      style={{
                        top,
                        height,
                        left: `calc(${(lane / lanes) * 100}% + 2px)`,
                        width: `calc(${100 / lanes}% - 4px)`,
                        "--event-color": item.color,
                      } as React.CSSProperties}
                      onClick={() => openItem(item)}
                      title={`${hhmm(item.start)}–${hhmm(item.end)} · ${item.title}${item.sub ? ` · ${item.sub}` : ""}`}
                      disabled={item.kind === "google" && !item.link}
                    >
                      <span>{hhmm(item.start)}</span>
                      <strong>{item.title}</strong>
                      {height > 40 && item.sub && <small>{item.sub}</small>}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  let body: React.ReactNode;
  if (view === "day") {
    // Atendentes ativos; "Sem responsável" só aparece se houver agendamento assim.
    const members = team.filter((m) => m.isActive);
    const cols: { key: string; label: React.ReactNode; day: Date; ownerId: string | null }[] = members.map((m) => ({
      key: m.id,
      day: anchor,
      ownerId: m.id,
      label: (
        <span className="cal-owner">
          <i style={{ background: colorOf.get(m.id) }} />
          {m.id === currentUserId ? `${m.name} (você)` : m.name}
        </span>
      ),
    }));
    if (visibleItems.some((i) => i.ownerId === null && sameDay(i.start, anchor))) {
      cols.push({ key: UNASSIGNED, day: anchor, ownerId: null, label: <span className="cal-owner">Sem responsável</span> });
    }
    body = timeGrid(cols);
  } else if (view === "week") {
    body = timeGrid(
      days.map((d) => ({
        key: d.toISOString(),
        day: d,
        ownerId: currentUserId,
        today: sameDay(d, new Date()),
        label: (
          <span className="cal-day-label">
            <small>{d.toLocaleDateString("pt-BR", { weekday: "short" }).replace(".", "")}</small>
            <strong>{d.getDate()}</strong>
          </span>
        ),
      })),
    );
  } else {
    const month = anchor.getMonth();
    body = (
      <div className="cal-month">
        {["seg", "ter", "qua", "qui", "sex", "sáb", "dom"].map((d) => (
          <div key={d} className="cal-month-head">{d}</div>
        ))}
        {days.map((d) => {
          const dayItems = visibleItems.filter((i) => sameDay(i.start, d)).sort((a, b) => a.start.getTime() - b.start.getTime());
          const shown = dayItems.slice(0, 3);
          return (
            <div
              key={d.toISOString()}
              className={`cal-month-cell ${d.getMonth() !== month ? "outside" : ""} ${sameDay(d, new Date()) ? "today" : ""}`}
              onClick={() => {
                setAnchor(startOfDay(d));
                onCreateAt({ date: ymd(d), startTime: "09:00", ownerId: currentUserId });
              }}
            >
              <span className="cal-month-day">{d.getDate()}</span>
              {shown.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={`cal-chip ${item.kind} ${item.cancelled ? "cancelled" : ""}`}
                  style={{ "--event-color": item.color } as React.CSSProperties}
                  onClick={(e) => {
                    e.stopPropagation();
                    openItem(item);
                  }}
                  title={`${hhmm(item.start)} · ${item.title}`}
                >
                  <b>{hhmm(item.start)}</b> {item.title}
                </button>
              ))}
              {dayItems.length > shown.length && <span className="cal-more">+{dayItems.length - shown.length} mais</span>}
            </div>
          );
        })}
      </div>
    );
  }

  if (!now) {
    return (
      <section className="cal-board" aria-label="Calendário de agendamentos">
        <div className="empty-state"><div>Carregando agenda…</div></div>
      </section>
    );
  }

  return (
    <section className="cal-board" aria-label="Calendário de agendamentos">
      <div className="cal-toolbar">
        <div className="cal-nav">
          <button type="button" className="btn small" onClick={() => move(-1)} aria-label="Anterior">‹</button>
          <button type="button" className="btn small" onClick={() => setAnchor(startOfDay(new Date()))}>Hoje</button>
          <button type="button" className="btn small" onClick={() => move(1)} aria-label="Próximo">›</button>
        </div>
        <h2 className="cal-title">{title(view, anchor, days)}</h2>
        {view === "day" && (
          <input
            type="date"
            className="cal-date"
            value={ymd(anchor)}
            onChange={(e) => e.target.value && setAnchor(startOfDay(new Date(`${e.target.value}T12:00:00`)))}
            aria-label="Ir para a data"
          />
        )}
        <div className="cal-legend">
          <span><i style={{ background: "var(--orange)" }} />Agendado</span>
          <span><i style={{ background: "var(--green)" }} />Confirmado</span>
          <span><i style={{ background: "var(--blue)" }} />Google Agenda</span>
        </div>
        {loading && <span className="muted" style={{ fontSize: 12 }}>Atualizando…</span>}
      </div>
      {error && <p style={{ color: "var(--red)", fontSize: 13, fontWeight: 600, marginBottom: 10 }}>{error}</p>}
      {errorNames.length > 0 && (
        <p className="muted" style={{ fontSize: 12, marginBottom: 10 }}>
          Não foi possível ler a agenda Google de {errorNames.join(", ")}. Pode ser preciso reconectar.
        </p>
      )}
      {body}
    </section>
  );
}
