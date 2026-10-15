"use client";

import { useEffect, useRef, useState } from "react";
import { searchContactOptions, searchOpportunityOptions, type PickerOption } from "@/app/pickers/actions";

// Seletor com busca por digitação: no lugar de um <select> com milhares de
// contatos, o usuário digita e vê só os 15 melhores resultados. Funciona dentro
// de <form>: o id escolhido vai num <input type="hidden" name={name}>, então
// FormData continua funcionando como antes.

type Props = {
  name: string;
  kind: "contact" | "opportunity";
  /** Valor já escolhido (ao editar). */
  initial?: { id: string; label: string } | null;
  /** Permite limpar a seleção (campo opcional). */
  allowEmpty?: boolean;
  required?: boolean;
  placeholder?: string;
};

const SEARCH = { contact: searchContactOptions, opportunity: searchOpportunityOptions } as const;

export function EntityPicker({ name, kind, initial = null, allowEmpty = false, required = false, placeholder }: Props) {
  const [selected, setSelected] = useState<{ id: string; label: string } | null>(initial);
  const [query, setQuery] = useState(initial?.label ?? "");
  const [options, setOptions] = useState<PickerOption[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const seq = useRef(0);

  // Busca com atraso (debounce); descarta respostas fora de ordem.
  useEffect(() => {
    if (!open) return;
    const my = ++seq.current;
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await SEARCH[kind](selected && query === selected.label ? "" : query);
        if (my === seq.current) setOptions(res);
      } catch {
        if (my === seq.current) setOptions([]);
      } finally {
        if (my === seq.current) setLoading(false);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [query, open, kind, selected]);

  // Fecha ao clicar fora.
  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  // Texto digitado sem escolher um item da lista é inválido (o form não envia).
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    const typedWithoutChoice = query.trim() !== "" && !selected;
    el.setCustomValidity(typedWithoutChoice ? "Escolha um item da lista" : "");
  }, [query, selected]);

  const pick = (o: PickerOption) => {
    setSelected({ id: o.id, label: o.label });
    setQuery(o.label);
    setOpen(false);
  };

  return (
    <div ref={boxRef} style={{ position: "relative" }}>
      <input type="hidden" name={name} value={selected?.id ?? ""} />
      <input
        ref={inputRef}
        value={query}
        required={required && !selected}
        placeholder={placeholder ?? (kind === "contact" ? "Digite para buscar um contato..." : "Digite para buscar uma oportunidade...")}
        autoComplete="off"
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setQuery(e.target.value);
          setSelected(null);
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") setOpen(false);
          if (e.key === "Enter" && open && options[0] && !selected) {
            e.preventDefault();
            pick(options[0]);
          }
        }}
      />
      {allowEmpty && selected && (
        <button
          type="button"
          className="btn small ghost"
          style={{ position: "absolute", right: 4, top: 4 }}
          onClick={() => {
            setSelected(null);
            setQuery("");
            inputRef.current?.focus();
          }}
        >
          Limpar
        </button>
      )}
      {open && (
        <div
          className="modal"
          style={{ position: "absolute", left: 0, right: 0, top: "100%", zIndex: 30, maxHeight: 220, overflowY: "auto", marginTop: 2 }}
        >
          <div className="modal-body" style={{ padding: 4 }}>
            {loading && options.length === 0 ? (
              <div className="muted" style={{ fontSize: 12, padding: 8 }}>Buscando…</div>
            ) : options.length === 0 ? (
              <div className="muted" style={{ fontSize: 12, padding: 8 }}>Nada encontrado</div>
            ) : (
              options.map((o) => (
                <div
                  key={o.id}
                  className="row"
                  style={{ padding: "6px 8px", cursor: "pointer", borderRadius: 6 }}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => pick(o)}
                >
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{o.label}</div>
                  {o.hint && <div className="muted" style={{ fontSize: 11 }}>{o.hint}</div>}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
