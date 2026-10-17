"use client";

import { useActionState } from "react";
import { loginAction, type LoginState } from "./actions";

const initialState: LoginState = {};

export default function LoginPage() {
  const [state, formAction, pending] = useActionState(loginAction, initialState);

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#f6f7f8] px-4">
      <div className="w-full max-w-sm rounded-[22px] border border-[#edf0f2] bg-white p-9 shadow-[0_28px_80px_rgba(25,33,42,0.06)]">
        <div className="mb-9 flex items-center gap-3">
          <span className="grid h-8 w-8 place-items-center rounded-[9px] bg-[#15171a] text-white" aria-hidden="true">
            <svg viewBox="0 0 28 28" fill="none" className="h-5 w-5">
              <path d="M7 20V8l14 12V8" stroke="currentColor" strokeWidth="2.7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          <span className="text-base font-bold tracking-[-0.05em] text-[#15171a]">NovaCRM</span>
        </div>
        <h1 className="mb-1 text-2xl font-semibold tracking-[-0.05em] text-[#15171a]">Bem-vindo de volta</h1>
        <p className="mb-8 text-sm text-[#858e98]">Acesse sua conta para continuar.</p>

        <form action={formAction} className="space-y-4">
          <div>
            <label className="mb-2 block text-xs font-semibold text-[#59616a]">E-mail</label>
            <input
              name="email"
              type="email"
              required
              autoFocus
              className="w-full rounded-xl border border-[#dfe3e7] px-3.5 py-2.5 text-sm outline-none transition focus:border-[#356dc8] focus:ring-4 focus:ring-[#356dc8]/10"
              placeholder="voce@empresa.com"
            />
          </div>
          <div>
            <label className="mb-2 block text-xs font-semibold text-[#59616a]">Senha</label>
            <input
              name="password"
              type="password"
              required
              className="w-full rounded-xl border border-[#dfe3e7] px-3.5 py-2.5 text-sm outline-none transition focus:border-[#356dc8] focus:ring-4 focus:ring-[#356dc8]/10"
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
            className="w-full rounded-xl bg-[#1b1f23] px-4 py-3 text-sm font-semibold text-white shadow-[0_5px_14px_rgba(20,24,28,0.12)] transition duration-200 hover:-translate-y-0.5 hover:bg-black hover:shadow-[0_10px_22px_rgba(20,24,28,0.18)] disabled:opacity-60"
          >
            {pending ? "Entrando..." : "Entrar"}
          </button>
        </form>

        <p className="mt-6 text-center text-xs text-[#858e98]">
          Use as credenciais criadas pelo administrador da equipe.
        </p>
      </div>
    </div>
  );
}
