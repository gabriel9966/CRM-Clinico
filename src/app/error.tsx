"use client";

import { useEffect } from "react";
import { StatusScreen } from "@/components/shared/StatusScreen";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <StatusScreen
      code={error.digest ? `Erro · ${error.digest}` : "Erro"}
      title="Algo deu errado"
      message="Não foi possível carregar esta tela. Tente de novo; se continuar, avise o administrador com o código acima."
      action={
        <button type="button" onClick={reset} className="login-submit w-full rounded-xl px-4 py-3 text-sm font-semibold">
          Tentar novamente
        </button>
      }
    />
  );
}
