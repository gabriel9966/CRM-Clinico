"use client";

import { useActionState } from "react";
import Link from "next/link";
import { loginAction, type LoginState } from "./actions";

const initialState: LoginState = {};

export default function LoginPage() {
  const [state, formAction, pending] = useActionState(loginAction, initialState);

  return (
    <div className="login-shell flex min-h-screen items-center justify-center px-4 py-8">
      <div className="login-card w-full max-w-sm border bg-white p-9">
        <div className="mb-9 flex items-center gap-3">
          <span className="brand-mark" aria-hidden="true">
            <span className="brand-glyph">&lt;/&gt;</span>
          </span>
          <span className="brand-copy"><span className="brand-name">NovaCRM</span><span className="brand-byline">by Kodexx</span></span>
        </div>
        <h1 className="mb-1 text-2xl font-semibold">Bem-vindo de volta</h1>
        <p className="mb-8 text-sm text-[var(--text-faint)]">Acesse sua conta para continuar.</p>

        <form action={formAction} className="space-y-4">
          <div>
            <label className="mb-2 block text-xs font-semibold text-[var(--text-soft)]">E-mail</label>
            <input
              name="email"
              type="email"
              required
              autoFocus
              className="w-full rounded-xl border border-[var(--border)] px-3.5 py-2.5 text-sm outline-none transition focus:border-[var(--accent)] focus:ring-4 focus:ring-[var(--accent)]/10"
              placeholder="voce@empresa.com"
            />
          </div>
          <div>
            <label className="mb-2 block text-xs font-semibold text-[var(--text-soft)]">Senha</label>
            <input
              name="password"
              type="password"
              required
              className="w-full rounded-xl border border-[var(--border)] px-3.5 py-2.5 text-sm outline-none transition focus:border-[var(--accent)] focus:ring-4 focus:ring-[var(--accent)]/10"
              placeholder="••••••••"
            />
          </div>

          {state.error && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-600">
              {state.error}
            </p>
          )}

          <button
            type="submit"
            disabled={pending}
            className="login-submit w-full rounded-xl px-4 py-3 text-sm font-semibold transition duration-200 hover:-translate-y-0.5 disabled:opacity-60"
          >
            {pending ? "Entrando..." : "Entrar"}
          </button>
        </form>

        <p className="mt-6 text-center text-xs"><Link href="/forgot-password">Esqueci minha senha</Link></p>
        <p className="mt-6 text-center text-xs text-[var(--text-faint)]">
          Use as credenciais criadas pelo administrador da equipe.
        </p>
      </div>
    </div>
  );
}
