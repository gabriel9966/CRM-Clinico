"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { checkWhatsAppStatus, refreshWhatsAppQr } from "@/app/connections/actions";
import { Icon } from "@/components/icons";
export function ReconnectDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const router = useRouter();
  const [qr, setQr] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function generate() {
    setBusy(true); setError("");
    try { const result = await refreshWhatsAppQr(id); if (result.error) setError(result.error); if (result.qrcode) setQr(result.qrcode); }
    catch { setError("Não foi possível obter o QR Code. Confira a conexão com o provedor."); }
    finally { setBusy(false); }
  }
  useEffect(() => {
    let stopped = false;
    let running = false;
    const timer = setInterval(async () => {
      if (running) return;
      running = true;
      try { const result = await checkWhatsAppStatus(id); if (!stopped && result.status === "CONNECTED") { router.refresh(); onClose(); } }
      catch { if (!stopped) setError("Não foi possível verificar o status. Tente novamente."); }
      finally { running = false; }
    }, 5000);
    return () => { stopped = true; clearInterval(timer); };
  }, [id, onClose, router]);
  return (
    <div className="modal-overlay">
      <section className="modal" role="dialog" aria-modal="true" aria-labelledby="reconnect-title">
        <div className="modal-head">
          <h2 id="reconnect-title">Reconectar WhatsApp</h2>
          <button type="button" className="close-x" onClick={onClose} aria-label="Fechar"><Icon.close /></button>
        </div>
        <div className="modal-body">
          <p>Gere o QR Code e use WhatsApp → Dispositivos conectados → Conectar dispositivo. O histórico desta instância será preservado.</p>
          {qr && <Image unoptimized src={qr} width={240} height={240} alt="QR Code para reconectar a instância" style={{ display: "block", margin: "16px auto" }} />}
          {error && <p className="form-error" role="alert">{error}</p>}
          <button type="button" className="btn primary" disabled={busy} onClick={generate}>{busy ? "Gerando..." : qr ? "Gerar outro QR Code" : "Gerar QR Code"}</button>
        </div>
      </section>
    </div>
  );
}
