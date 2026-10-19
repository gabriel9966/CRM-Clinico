"use client";
import { useActionState } from "react";
import Link from "next/link";
import { requestPasswordReset, resetPassword, type RecoveryState } from "@/app/forgot-password/actions";
export function RecoveryForm({ token }: { token?: string }) {
  const [state, action, pending] = useActionState<RecoveryState, FormData>(token ? resetPassword : requestPasswordReset, {});
  return <div className="login-shell flex min-h-screen items-center justify-center px-4 py-8"><section className="login-card w-full max-w-sm border bg-white p-9"><h1>{token ? "Definir nova senha" : "Recuperar acesso"}</h1><p className="muted">{token ? "Escolha uma senha com pelo menos 12 caracteres." : "Informe o e-mail cadastrado na sua conta."}</p>
    {!state.done && <form action={action}>
      {token ? <><input type="hidden" name="token" value={token} /><div className="field"><label htmlFor="new-password">Nova senha</label><input id="new-password" name="password" type="password" minLength={12} maxLength={72} autoComplete="new-password" required /></div><div className="field"><label htmlFor="confirm-password">Confirme a senha</label><input id="confirm-password" name="confirmation" type="password" minLength={12} maxLength={72} autoComplete="new-password" required /></div></> : <div className="field"><label htmlFor="recovery-email">E-mail</label><input id="recovery-email" name="email" type="email" maxLength={254} autoComplete="email" required /></div>}
      {state.error && <p role="alert" className="form-error">{state.error}</p>}
      <button className="btn primary" disabled={pending}>{pending ? "Processando..." : token ? "Salvar nova senha" : "Enviar link de recuperação"}</button>
    </form>}
    {state.message && <p role="status">{state.message}</p>}
    <p><Link href="/login">Voltar para o login</Link></p>
  </section></div>;
}
