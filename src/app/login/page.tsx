"use client";

import { Suspense, useActionState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { loginAction, type LoginState } from "./actions";

const initialState: LoginState = {};

const GOOGLE_ERRORS: Record<string, string> = {
  google_failed: "Não foi possível entrar com o Google. Tente novamente.",
  google_no_account: "Esta conta Google não tem acesso ao CRM. Peça ao administrador para cadastrar seu e-mail.",
  google_not_configured: "O login com Google ainda não foi configurado.",
  google_rate_limited: "Muitas tentativas. Tente novamente em alguns minutos.",
  suspended: "O acesso da sua empresa está suspenso. Fale com o administrador da plataforma.",
};

function GoogleError() {
  const code = useSearchParams().get("error");
  const message = code ? GOOGLE_ERRORS[code] : undefined;
  if (!message) return null;
  return <p className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-600">{message}</p>;
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}

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

        <Suspense fallback={null}>
          <GoogleError />
        </Suspense>

        <a
          href="/api/auth/google/start"
          className="flex w-full items-center justify-center gap-2.5 rounded-xl border border-[var(--border)] bg-white px-4 py-2.5 text-sm font-semibold text-[var(--text)] transition hover:bg-[var(--bg)]"
        >
          <GoogleIcon />
          Entrar com Google
        </a>

        <div className="my-6 flex items-center gap-3 text-xs text-[var(--text-faint)]">
          <span className="h-px flex-1 bg-[var(--border)]" />
          ou com e-mail
          <span className="h-px flex-1 bg-[var(--border)]" />
        </div>

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
