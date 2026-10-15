"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Icon } from "@/components/icons";
import { fmtDate } from "@/lib/format";
import type { TrashItemDTO, TrashEntity } from "@/lib/types";
import { restoreItem, purgeItem, emptyTrash } from "@/app/trash/actions";

const ENTITY_LABEL: Record<TrashEntity, string> = {
  contact: "Contato",
  opportunity: "Negócio",
  appointment: "Agendamento",
};

export function TrashView({ items }: { items: TrashItemDTO[] }) {
  const router = useRouter();
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  async function act(key: string, fn: () => Promise<{ ok: boolean; error?: string }>, okText: string) {
    setBusyKey(key);
    setMessage(null);
    try {
      const res = await fn();
      setMessage(res.ok ? { kind: "ok", text: okText } : { kind: "error", text: res.error ?? "Não foi possível concluir." });
      router.refresh();
    } catch {
      setMessage({ kind: "error", text: "Não foi possível concluir. Tente novamente." });
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <>
      <div className="topbar">
        <div>
          <h1>Lixeira</h1>
          <div className="sub">
            O que foi excluído fica aqui e pode ser restaurado. Contatos levam junto seus negócios e agendamentos.
          </div>
        </div>
        <button
          className="btn danger"
          disabled={busyKey !== null || items.length === 0}
          onClick={() => {
            if (!confirm("Apagar DE VEZ tudo que está na lixeira há mais de 30 dias? Isso não pode ser desfeito.")) return;
            act("empty", async () => {
              const r = await emptyTrash(30);
              return r.ok ? { ok: true } : r;
            }, "Itens antigos removidos definitivamente.");
          }}
        >
          <Icon.trash /> Esvaziar itens com mais de 30 dias
        </button>
      </div>

      <div className="content">
        {message && (
          <p style={{ color: message.kind === "ok" ? "var(--green)" : "var(--red)", fontSize: 13, fontWeight: 600, marginBottom: 12 }}>
            {message.text}
          </p>
        )}
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Tipo</th><th>Item</th><th>Detalhe</th><th>Excluído em</th><th></th></tr>
            </thead>
            <tbody>
              {items.length === 0 ? (
                <tr><td colSpan={5}><div className="empty-state"><Icon.trash /><div>A lixeira está vazia</div></div></td></tr>
              ) : (
                items.map((it) => {
                  const key = `${it.entity}:${it.id}`;
                  return (
                    <tr key={key}>
                      <td><span className="pill" style={{ background: "var(--border-soft)", color: "var(--text-soft)" }}>{ENTITY_LABEL[it.entity]}</span></td>
                      <td style={{ fontWeight: 700 }}>{it.title}</td>
                      <td className="muted">
                        {it.entity === "appointment" && it.detail ? fmtDate(it.detail) : it.detail ?? "—"}
                      </td>
                      <td className="muted">{fmtDate(it.deletedAt)}</td>
                      <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                        <button
                          className="btn small"
                          disabled={busyKey !== null}
                          onClick={() => act(key, () => restoreItem(it.entity, it.id), `${ENTITY_LABEL[it.entity]} restaurado.`)}
                        >
                          Restaurar
                        </button>{" "}
                        <button
                          className="btn small danger"
                          disabled={busyKey !== null}
                          onClick={() => {
                            if (!confirm(`Apagar "${it.title}" DE VEZ? Isso não pode ser desfeito.`)) return;
                            act(key, () => purgeItem(it.entity, it.id), "Item apagado definitivamente.");
                          }}
                        >
                          Apagar de vez
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        {items.length >= 100 && (
          <p className="muted" style={{ fontSize: 12, marginTop: 10 }}>
            Mostrando os 100 itens mais recentes de cada tipo.
          </p>
        )}
      </div>
    </>
  );
}
