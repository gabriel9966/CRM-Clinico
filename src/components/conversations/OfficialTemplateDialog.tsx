"use client";
import { useState } from "react";
import { Icon } from "@/components/icons";
import type { MessageTemplateDTO } from "@/lib/types";

export function OfficialTemplateDialog({ templates, onClose, onSend }: { templates: MessageTemplateDTO[]; onClose: () => void; onSend: (id: string, parameters: string[]) => Promise<void> }) {
  const [id, setId] = useState(templates[0]?.id ?? "");
  const [parameters, setParameters] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const template = templates.find((item) => item.id === id);
  const count = Math.max(0, ...[...(template?.body ?? "").matchAll(/\{\{(\d+)\}\}/g)].map((match) => Number(match[1])));
  return <div className="modal-overlay"><section className="modal" role="dialog" aria-modal="true" aria-labelledby="official-template-title"><div className="modal-head"><h2 id="official-template-title">Enviar template oficial</h2><button type="button" className="close-x" onClick={onClose} disabled={busy} aria-label="Fechar"><Icon.close /></button></div><form onSubmit={async (event) => {
    event.preventDefault(); setBusy(true); setError("");
    try { await onSend(id, Array.from({ length: count }, (_, index) => parameters[index]?.trim() ?? "")); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "Não foi possível enviar."); }
    finally { setBusy(false); }
  }}><div className="modal-body">
    {templates.length === 0 ? <p>Nenhum template oficial cadastrado. Peça ao administrador para cadastrar em Campanhas → Templates oficiais um modelo aprovado no WhatsApp Manager.</p> : <>
      <div className="field"><label htmlFor="official-template">Modelo aprovado</label><select id="official-template" value={id} onChange={(event) => { setId(event.target.value); setParameters([]); setError(""); }}>{templates.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.cloudLanguage}</option>)}</select></div>
      {Array.from({ length: count }, (_, index) => <div className="field" key={index}><label htmlFor={`template-parameter-${index}`}>Parâmetro {index + 1}</label><input id={`template-parameter-${index}`} required maxLength={4000} value={parameters[index] ?? ""} onChange={(event) => setParameters((previous) => { const next = [...previous]; next[index] = event.target.value; return next; })} /></div>)}
      <div className="official-template-preview"><span>PRÉVIA DA MENSAGEM</span><p>{template?.body.replace(/\{\{(\d+)\}\}/g, (match, index: string) => parameters[Number(index) - 1] || match)}</p></div>
      <p className="muted">O envio usa a instância vinculada a este atendimento. A Meta confere o status e a aprovação do modelo ao enviar.</p>
    </>}
    {error && <p className="form-error" role="alert">{error}</p>}
  </div><div className="modal-foot"><button type="button" className="btn" onClick={onClose} disabled={busy}>Cancelar</button><button className="btn primary" disabled={busy || !template}>{busy ? "Enviando..." : "Enviar template"}</button></div></form></section></div>;
}
