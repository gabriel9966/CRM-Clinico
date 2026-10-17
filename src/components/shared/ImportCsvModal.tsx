"use client";

import { useState } from "react";
import { Icon } from "@/components/icons";
import { csvHeader, csvLine, parseCsvTable } from "@/lib/csv";

export type ImportSummary = { created: number; skipped: number; errors: string[] };
export type ImportColumn = { key: string; label: string; aliases?: string[]; required?: boolean };

const MAX_FILE_BYTES = 20_000_000;
const BATCH_ROWS = 500;
const BATCH_CHARS = 500_000;
const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");

export function ImportCsvModal({
  title,
  hint,
  columns,
  templateName,
  onImport,
  onClose,
  onDone,
}: {
  title: string;
  hint: string;
  columns: ImportColumn[];
  templateName: string;
  onImport: (csvText: string) => Promise<ImportSummary>;
  onClose: () => void;
  onDone: () => void;
}) {
  const [file, setFile] = useState<{ name: string; headers: string[]; rows: Record<string, string>[] } | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<ImportSummary | null>(null);
  const [error, setError] = useState("");

  async function readFile(selected: File | undefined) {
    setResult(null);
    setError("");
    setFile(null);
    if (!selected) return;
    if (selected.size > MAX_FILE_BYTES) {
      setError("O CSV deve ter no máximo 20 MB. Divida arquivos maiores em partes.");
      return;
    }
    try {
      const parsed = parseCsvTable(await selected.text());
      if (!parsed.headers.length || !parsed.rows.length) throw new Error("O arquivo precisa ter cabeçalho e ao menos uma linha de dados.");
      const auto: Record<string, string> = {};
      for (const column of columns) {
        auto[column.key] = parsed.headers.find((header) =>
          [column.key, column.label, ...(column.aliases ?? [])].some((candidate) => normalize(candidate) === normalize(header))
        ) ?? "";
      }
      setMapping(auto);
      setFile({ name: selected.name, ...parsed });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível ler o CSV.");
    }
  }

  async function handleImport() {
    if (!file || busy) return;
    const missing = columns.filter((column) => column.required && !mapping[column.key]);
    if (missing.length) {
      setError(`Associe as colunas obrigatórias: ${missing.map((column) => column.label).join(", ")}.`);
      return;
    }
    setBusy(true);
    setProgress(0);
    setError("");
    const summary: ImportSummary = { created: 0, skipped: 0, errors: [] };
    let processed = 0;
    try {
      const keys = columns.map((column) => column.key);
      const normalizedRows = file.rows.map((row) => Object.fromEntries(keys.map((key) => [key, mapping[key] ? row[mapping[key]] ?? "" : ""])));
      const header = csvHeader(keys);
      const batches: { csv: string; count: number }[] = [];
      let lines: string[] = [];
      let chars = header.length + 1;
      for (const row of normalizedRows) {
        const line = csvLine(row, keys);
        if (line.length > BATCH_CHARS) throw new Error("Uma linha do arquivo é grande demais para importar.");
        if (lines.length && (lines.length >= BATCH_ROWS || chars + line.length + 1 > BATCH_CHARS)) {
          batches.push({ csv: `${header}\n${lines.join("\n")}`, count: lines.length });
          lines = [];
          chars = header.length + 1;
        }
        lines.push(line);
        chars += line.length + 1;
      }
      if (lines.length) batches.push({ csv: `${header}\n${lines.join("\n")}`, count: lines.length });
      for (const batch of batches) {
        const part = await onImport(batch.csv);
        summary.created += part.created;
        summary.skipped += part.skipped;
        summary.errors.push(...part.errors.map((message) => message.replace(/Linha (\d+)/, (_, line: string) => `Linha ${Number(line) + processed}`)));
        processed += batch.count;
        setProgress(processed);
      }
      setResult(summary);
      if (summary.created > 0) onDone();
    } catch (cause) {
      setError(`${cause instanceof Error ? cause.message : "Não foi possível importar o arquivo."}${processed ? ` ${processed} linha(s) já processada(s); confira o resultado antes de tentar novamente.` : ""}`);
      if (processed) {
        setResult(summary);
        if (summary.created > 0) onDone();
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal wide" onClick={(event) => event.stopPropagation()}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="close-x" onClick={onClose} aria-label="Fechar"><Icon.close /></button>
        </div>
        <div className="modal-body">
          <p className="muted" style={{ fontSize: 12.5, marginTop: 0 }}>{hint}</p>
          <a className="btn small" download={templateName} href={`data:text/csv;charset=utf-8,${encodeURIComponent(`\uFEFF${csvHeader(columns.map((column) => column.key))}\n`)}`}>
            <Icon.download /> Baixar modelo CSV
          </a>
          <div className="field" style={{ marginTop: 16 }}>
            <label>Arquivo CSV (até 20 MB)</label>
            <input type="file" accept=".csv,text/csv" onChange={(event) => void readFile(event.target.files?.[0])} />
          </div>
          {file && (
            <>
              <p className="muted" style={{ fontSize: 12 }}>{file.name} · {file.rows.length.toLocaleString("pt-BR")} linha(s). Confira a associação das colunas antes de importar.</p>
              <div className="import-mapping">
                {columns.map((column) => (
                  <div className="field" key={column.key}>
                    <label>{column.label}{column.required ? " *" : ""}</label>
                    <select value={mapping[column.key] ?? ""} onChange={(event) => setMapping((current) => ({ ...current, [column.key]: event.target.value }))}>
                      <option value="">Não importar</option>
                      {file.headers.map((header, index) => <option key={`${header}-${index}`} value={header}>{header}</option>)}
                    </select>
                  </div>
                ))}
              </div>
              <div className="import-preview">
                <strong>Prévia das primeiras linhas</strong>
                <div className="table-wrap"><table><thead><tr>{file.headers.map((header, index) => <th key={`${header}-${index}`}>{header}</th>)}</tr></thead><tbody>{file.rows.slice(0, 3).map((row, index) => <tr key={index}>{file.headers.map((header, cell) => <td key={`${header}-${cell}`}>{row[header] || "—"}</td>)}</tr>)}</tbody></table></div>
              </div>
            </>
          )}
          {error && <p className="form-error" role="alert">{error}</p>}
          {busy && file && <p className="muted" role="status">Importando {progress.toLocaleString("pt-BR")} de {file.rows.length.toLocaleString("pt-BR")} linhas…</p>}
          {result && (
            <div className="import-result" role="status">
              <strong>{result.created} criado(s), {result.skipped} ignorado(s).</strong>
              {result.errors.length > 0 && <ul>{result.errors.slice(0, 12).map((message, index) => <li key={index}>{message}</li>)}{result.errors.length > 12 && <li>…e mais {result.errors.length - 12} ocorrência(s).</li>}</ul>}
            </div>
          )}
        </div>
        <div className="modal-foot">
          <button type="button" className="btn" onClick={onClose}>Fechar</button>
          <button type="button" className="btn primary" disabled={!file || busy || (!!result && !error)} onClick={handleImport}>
            {busy ? "Importando..." : error && result ? "Tentar novamente" : "Importar dados"}
          </button>
        </div>
      </div>
    </div>
  );
}
