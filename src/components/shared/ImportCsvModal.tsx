"use client";

import { useRef, useState } from "react";
import { Icon } from "@/components/icons";

export type ImportSummary = { created: number; skipped: number; errors: string[] };

export function ImportCsvModal({
  title,
  hint,
  templateColumns,
  onImport,
  onClose,
  onDone,
}: {
  title: string;
  hint: string;
  templateColumns: string;
  onImport: (csvText: string) => Promise<ImportSummary>;
  onClose: () => void;
  onDone: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ImportSummary | null>(null);

  async function handleImport() {
    const file = fileRef.current?.files?.[0];
    if (!file) return;
    setBusy(true);
    try {
      const text = await file.text();
      const summary = await onImport(text);
      setResult(summary);
      if (summary.created > 0) onDone();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="close-x" onClick={onClose}><Icon.close /></button>
        </div>
        <div className="modal-body">
          <p className="muted" style={{ fontSize: 12.5, marginTop: 0 }}>{hint}</p>
          <div className="code-hint">
            Colunas do CSV: <code>{templateColumns}</code>
          </div>
          <div className="field">
            <label>Arquivo CSV</label>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => {
                setFileName(e.target.files?.[0]?.name ?? "");
                setResult(null);
              }}
            />
          </div>
          {result && (
            <div
              style={{
                fontSize: 13,
                background: result.created > 0 ? "var(--green-soft)" : "var(--red-soft)",
                color: result.created > 0 ? "var(--green)" : "var(--red)",
                borderRadius: 10,
                padding: "10px 12px",
                fontWeight: 600,
              }}
            >
              {result.created} criado(s), {result.skipped} ignorado(s).
              {result.errors.length > 0 && (
                <ul style={{ margin: "6px 0 0", paddingLeft: 18, fontWeight: 500 }}>
                  {result.errors.slice(0, 8).map((e, i) => <li key={i}>{e}</li>)}
                  {result.errors.length > 8 && <li>...e mais {result.errors.length - 8}.</li>}
                </ul>
              )}
            </div>
          )}
        </div>
        <div className="modal-foot">
          <button type="button" className="btn" onClick={onClose}>Fechar</button>
          <button type="button" className="btn primary" disabled={!fileName || busy} onClick={handleImport}>
            {busy ? "Importando..." : "Importar"}
          </button>
        </div>
      </div>
    </div>
  );
}
