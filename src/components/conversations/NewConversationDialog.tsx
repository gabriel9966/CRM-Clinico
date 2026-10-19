"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { EntityPicker } from "@/components/shared/EntityPicker";
import { Icon } from "@/components/icons";
import { startConversation } from "@/app/conversations/actions";
import type { ConnectionDTO } from "@/lib/types";
export function NewConversationDialog({ connections, onClose }: { connections: ConnectionDTO[]; onClose: () => void }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const available = connections.filter((item) => item.status === "CONNECTED");
  return <div className="modal-overlay"><section className="modal" role="dialog" aria-modal="true" aria-labelledby="new-conversation-title"><div className="modal-head"><h2 id="new-conversation-title">Novo atendimento</h2><button type="button" className="close-x" aria-label="Fechar" onClick={onClose}><Icon.close /></button></div><form onSubmit={async (event) => {
    event.preventDefault(); const form = new FormData(event.currentTarget); setBusy(true); setError("");
    try {
      const result = await startConversation(String(form.get("contactId") || ""), String(form.get("connectionId") || ""));
      if (result.error) { setError(result.error); return; }
      router.push(`/conversations?conversation=${encodeURIComponent(result.id!)}`); router.refresh(); onClose();
    } catch { setError("Não foi possível abrir o atendimento. Tente novamente."); }
    finally { setBusy(false); }
  }}><div className="modal-body"><div className="field"><label>Contato</label><EntityPicker name="contactId" kind="contact" required /></div><div className="field"><label htmlFor="new-conversation-instance">Instância remetente</label><select id="new-conversation-instance" name="connectionId" required defaultValue=""><option value="" disabled>Selecione o canal e a instância</option>{available.map((item) => <option key={item.id} value={item.id}>{item.label} · {item.provider.replaceAll("WHATSAPP_", "WhatsApp ")}</option>)}</select></div><p className="muted">Cada instância possui seu próprio atendimento. Se já existir um histórico nesta instância, ele será aberto.</p>{available.length === 0 && <p role="status">Nenhuma instância conectada disponível. Configure uma conexão ou solicite acesso ao administrador.</p>}{error && <p className="form-error" role="alert">{error}</p>}</div><div className="modal-foot"><button type="button" className="btn" onClick={onClose}>Cancelar</button><button className="btn primary" disabled={busy || !available.length}>{busy ? "Abrindo..." : "Abrir atendimento"}</button></div></form></section></div>;
}
