"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icons";
import { fmtMoney } from "@/lib/format";
import { globalSearchAction } from "@/app/search/actions";
import type { GlobalSearchResult } from "@/lib/search";

export function GlobalSearch() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<GlobalSearchResult>({ contacts: [], opportunities: [] });
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      if (!query.trim()) {
        setResult({ contacts: [], opportunities: [] });
        return;
      }
      setLoading(true);
      const r = await globalSearchAction(query);
      setResult(r);
      setLoading(false);
    }, 250);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  function goToContact(id: string, name: string) {
    setOpen(false);
    setQuery("");
    router.push(`/contacts?q=${encodeURIComponent(name)}&contact=${id}`);
  }

  function goToOpportunity() {
    setOpen(false);
    setQuery("");
    router.push("/pipeline");
  }

  const hasResults = result.contacts.length > 0 || result.opportunities.length > 0;

  return (
    <>
      <button className="global-search-trigger" onClick={() => setOpen(true)}>
        <Icon.search /> <span>Buscar...</span>
      </button>

      {open && (
        <div className="modal-overlay" onClick={() => setOpen(false)}>
          <div className="modal" style={{ maxWidth: 520, marginTop: 80 }} onClick={(e) => e.stopPropagation()}>
            <div className="search-bar" style={{ margin: 16 }}>
              <Icon.search />
              <input
                autoFocus
                placeholder="Buscar contatos ou oportunidades..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            <div style={{ maxHeight: 360, overflowY: "auto", padding: "0 16px 16px" }}>
              {!query.trim() ? (
                <div className="muted" style={{ fontSize: 12, padding: "0 4px 8px" }}>Digite pra buscar em contatos e oportunidades.</div>
              ) : loading ? (
                <div className="muted" style={{ fontSize: 12, padding: "0 4px 8px" }}>Buscando...</div>
              ) : !hasResults ? (
                <div className="empty-state"><Icon.empty /><div>Nada encontrado</div></div>
              ) : (
                <>
                  {result.contacts.length > 0 && (
                    <div style={{ marginBottom: 12 }}>
                      <div className="nav-section-label" style={{ padding: "4px 0" }}>Contatos</div>
                      {result.contacts.map((c) => (
                        <div key={c.id} className="row" style={{ padding: "8px 4px", cursor: "pointer" }} onClick={() => goToContact(c.id, c.name)}>
                          <div style={{ fontWeight: 600, fontSize: 13 }}>{c.name}</div>
                          <div className="muted" style={{ fontSize: 12 }}>{c.email || c.phone || c.company || "—"}</div>
                        </div>
                      ))}
                    </div>
                  )}
                  {result.opportunities.length > 0 && (
                    <div>
                      <div className="nav-section-label" style={{ padding: "4px 0" }}>Oportunidades</div>
                      {result.opportunities.map((o) => (
                        <div key={o.id} className="row" style={{ padding: "8px 4px", cursor: "pointer" }} onClick={() => goToOpportunity()}>
                          <div style={{ fontWeight: 600, fontSize: 13 }}>{o.title}</div>
                          <div className="muted" style={{ fontSize: 12 }}>{o.contactName} · {fmtMoney(o.value)}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
