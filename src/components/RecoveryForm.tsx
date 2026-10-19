"use client";
import { useActionState, type ReactNode } from "react";
import Link from "next/link";
import { requestPasswordReset, resetPassword, type RecoveryState } from "@/app/forgot-password/actions";

const INPUT = "w-full rounded-xl border border-[var(--border)] px-3.5 py-2.5 text-sm outline-none transition focus:border-[var(--accent)] focus:ring-4 focus:ring-[var(--accent)]/10";
const LABEL = "mb-2 block text-xs font-semibold text-[var(--text-soft)]";

/** Mesmo cartão e identidade da tela de login (logo, título, rodapé). */
export function AuthCard({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <div className="login-shell flex min-h-screen items-center justify-center px-4 py-8">
      <section className="login-card w-full max-w-sm border bg-white p-9">
        <div className="mb-9 flex items-center gap-3">
          <span className="brand-mark" aria-hidden="true">
            <span className="brand-glyph">&lt;/&gt;</span>
          </span>
          <span className="brand-copy"><span className="brand-name">NovaCRM</span><span className="brand-byline">by Kodexx</span></span>
        </div>
        <h1 className="mb-1 text-2xl font-semibold">{title}</h1>
        <p className="mb-8 text-sm text-[var(--text-faint)]">{subtitle}</p>
        {children}
        <p className="mt-6 text-center text-xs"><Link href="/login">Voltar para o login</Link></p>
      </section>
    </div>
  );
}

export function RecoveryForm({ token }: { token?: string }) {
  const [state, action, pending] = useActionState<RecoveryState, FormData>(token ? resetPassword : requestPasswordReset, {});
  return (
    <AuthCard
      title={token ? "Definir nova senha" : "Recuperar acesso"}
      subtitle={token ? "Escolha uma senha com pelo menos 12 caracteres." : "Informe o e-mail cadastrado na sua conta."}
    >
      {!state.done && (
        <form action={action} className="space-y-4">
          {token ? (
            <>
              <input type="hidden" name="token" value={token} />
              <div>
                <label className={LABEL} htmlFor="new-password">Nova senha</label>
                <input id="new-password" name="password" type="password" minLength={12} maxLength={72} autoComplete="new-password" required autoFocus className={INPUT} />
              </div>
              <div>
                <label className={LABEL} htmlFor="confirm-password">Confirme a senha</label>
                <input id="confirm-password" name="confirmation" type="password" minLength={12} maxLength={72} autoComplete="new-password" required className={INPUT} />
              </div>
            </>
          ) : (
            <div>
              <label className={LABEL} htmlFor="recovery-email">E-mail</label>
              <input id="recovery-email" name="email" type="email" maxLength={254} autoComplete="email" required autoFocus className={INPUT} placeholder="voce@empresa.com" />
            </div>
          )}
          {state.error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-600">{state.error}</p>}
          <button type="submit" disabled={pending} className="login-submit w-full rounded-xl px-4 py-3 text-sm font-semibold transition duration-200 hover:-translate-y-0.5 disabled:opacity-60">
            {pending ? "Processando..." : token ? "Salvar nova senha" : "Enviar link de recuperação"}
          </button>
        </form>
      )}
      {state.message && <p role="status" className="rounded-lg bg-[var(--green-soft)] px-3 py-2 text-sm font-medium text-[var(--green)]">{state.message}</p>}
    </AuthCard>
  );
}
