"use client";

// Último recurso: falha no próprio layout raiz. Não depende de CSS do app.
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="pt-BR">
      <body style={{ margin: 0, minHeight: "100vh", display: "grid", placeItems: "center", background: "#0f2a4a", fontFamily: "system-ui, sans-serif" }}>
        <div style={{ background: "#fff", borderRadius: 16, padding: 36, maxWidth: 360, textAlign: "center", color: "#18202a" }}>
          <h1 style={{ fontSize: 20, margin: "0 0 8px" }}>Algo deu errado</h1>
          <p style={{ fontSize: 14, color: "#5d6d7e", margin: "0 0 24px" }}>O NovaCRM encontrou um erro inesperado.</p>
          <button
            type="button"
            onClick={reset}
            style={{ border: 0, borderRadius: 12, padding: "12px 20px", background: "#17c99a", fontWeight: 600, cursor: "pointer" }}
          >
            Tentar novamente
          </button>
        </div>
      </body>
    </html>
  );
}
