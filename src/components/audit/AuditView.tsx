"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/icons";
import type { AuditLogDTO } from "@/lib/audit";
import { fetchAuditLogs } from "@/app/audit/actions";

// Rótulos legíveis para as ações registradas.
const ACTION_LABEL: Record<string, string> = {
  "contact.deleted": "Contato excluído",
  "contact.restored": "Contato restaurado",
  "contact.purged": "Contato apagado de vez",
  "contact.merged": "Contatos mesclados",
  "contact.exported": "Contatos exportados (CSV)",
  "opportunity.deleted": "Negócio excluído",
  "opportunity.restored": "Negócio restaurado",
  "opportunity.purged": "Negócio apagado de vez",
  "opportunity.exported": "Negócios exportados (CSV)",
  "opportunity.item_added": "Item adicionado ao negócio",
  "opportunity.item_updated": "Item do negócio alterado",
  "opportunity.item_removed": "Item removido do negócio",
  "appointment.created": "Agendamento criado",
  "appointment.cancelled": "Agendamento cancelado",
  "appointment.rescheduled": "Agendamento remarcado",
  "appointment.no_show": "Falta registrada",
  "appointment.deleted": "Agendamento excluído",
  "appointment.restored": "Agendamento restaurado",
  "appointment.purged": "Agendamento apagado de vez",
  "block.created": "Bloqueio de agenda criado",
  "block.deleted": "Bloqueio de agenda removido",
  "tag.created": "Etiqueta criada",
  "tag.renamed": "Etiqueta renomeada",
  "tag.deleted": "Etiqueta excluída",
  "loss_reason.created": "Motivo de perda criado",
  "trash.emptied": "Lixeira esvaziada",
};

const ENTITIES = ["Contact", "Opportunity", "Appointment", "ScheduleBlock", "Tag", "LossReason", "Trash"];

function metaSummary(meta: Record<string, unknown>): string {
  const entries = Object.entries(meta).filter(([, v]) => v !== null && v !== undefined && v !== "");
  return entries.map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`).join(" · ");
}

export function AuditView({ initialItems, initialCursor }: { initialItems: AuditLogDTO[]; initialCursor: string | null }) {
  const [items, setItems] = useState(initialItems);
  const [cursor, setCursor] = useState<string | null>(initialCursor);
  const [entity, setEntity] = useState("");
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);
  const firstRun = useRef(true);

  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    const mine = ++seq.current;
    setLoading(true);
    setError(null);
    const timer = setTimeout(async () => {
      try {
        const page = await fetchAuditLogs({ entity: entity || undefined, q: q.trim() || undefined });
        if (mine !== seq.current) return;
        setItems(page.items);
        setCursor(page.nextCursor);
      } catch {
        if (mine === seq.current) setError("Não foi possível carregar o log.");
      } finally {
        if (mine === seq.current) setLoading(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [entity, q]);

  async function loadMore() {
    if (!cursor || loading) return;
    setLoading(true);
    try {
      const page = await fetchAuditLogs({ cursor, entity: entity || undefined, q: q.trim() || undefined });
      setItems((prev) => [...prev, ...page.items]);
      setCursor(page.nextCursor);
    } catch {
      setError("Não foi possível carregar mais registros.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <div className="topbar">
        <div>
          <h1>Auditoria</h1>
          <div className="sub">Quem fez o quê e quando — exclusões, restaurações, exportações e mudanças na agenda</div>
        </div>
      </div>

      <div className="content">
        <div className="pipeline-bar" style={{ gap: 8 }}>
          <div className="search-bar" style={{ margin: 0, flex: 1, maxWidth: 360 }}>
            <Icon.search />
            <input placeholder="Buscar por pessoa, ação ou id..." value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <select value={entity} onChange={(e) => setEntity(e.target.value)} style={{ maxWidth: 220 }}>
            <option value="">Todos os tipos</option>
            {ENTITIES.map((e) => <option key={e} value={e}>{e}</option>)}
          </select>
          {loading && <span className="muted" style={{ fontSize: 12 }}>Atualizando…</span>}
        </div>
        {error && <p style={{ color: "var(--red)", fontSize: 13, fontWeight: 600, marginBottom: 10 }}>{error}</p>}

        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Quando</th><th>Quem</th><th>Ação</th><th>Detalhes</th></tr>
            </thead>
            <tbody>
              {items.length === 0 ? (
                <tr><td colSpan={4}><div className="empty-state"><Icon.empty /><div>Nenhum registro</div></div></td></tr>
              ) : (
                items.map((it) => (
                  <tr key={it.id}>
                    <td className="muted" style={{ whiteSpace: "nowrap" }}>
                      {new Date(it.createdAt).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" })}
                    </td>
                    <td style={{ fontWeight: 600 }}>{it.actorName ?? "—"}</td>
                    <td>{ACTION_LABEL[it.action] ?? it.action}</td>
                    <td className="muted" style={{ fontSize: 12, maxWidth: 420 }}>
                      {it.entityId && <span style={{ marginRight: 8 }}>{it.entity} {it.entityId.slice(-8)}</span>}
                      {metaSummary(it.meta)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {cursor && (
          <div style={{ textAlign: "center", marginTop: 14 }}>
            <button className="btn" onClick={loadMore} disabled={loading}>
              {loading ? "Carregando…" : "Carregar mais"}
            </button>
          </div>
        )}
      </div>
    </>
  );
}
