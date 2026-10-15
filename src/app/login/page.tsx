"use client";

import { useActionState } from "react";
import { loginAction, type LoginState } from "./actions";

const initialState: LoginState = {};

export default function LoginPage() {
  const [state, formAction, pending] = useActionState(loginAction, initialState);

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#f4f5f7] px-4">
      <div className="w-full max-w-sm rounded-2xl border border-[#e3e5ea] bg-white p-8 shadow-sm">
        <div className="mb-6 flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-sm bg-indigo-600 shadow-[0_0_0_4px_rgba(79,70,229,0.2)]" />
          <span className="text-base font-extrabold text-[#1a1d23]">NovaCRM</span>
        </div>
        <h1 className="mb-1 text-lg font-bold text-[#1a1d23]">Entrar</h1>
        <p className="mb-6 text-sm text-[#8d92a3]">Acesse sua conta para continuar.</p>

        <form action={formAction} className="space-y-4">
          <div>
            <label className="mb-1 block text-xs font-bold text-[#5b6072]">E-mail</label>
            <input
              name="email"
              type="email"
              required
              autoFocus
              className="w-full rounded-lg border border-[#e3e5ea] px-3 py-2 text-sm outline-none focus:border-indigo-600"
              placeholder="voce@empresa.com"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-bold text-[#5b6072]">Senha</label>
            <input
              name="password"
              type="password"
              required
              className="w-full rounded-lg border border-[#e3e5ea] px-3 py-2 text-sm outline-none focus:border-indigo-600"
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
            className="w-full rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-indigo-700 disabled:opacity-60"
          >
            {pending ? "Entrando..." : "Entrar"}
          </button>
        </form>

        <p className="mt-5 text-center text-xs text-[#8d92a3]">
          Use as credenciais criadas pelo administrador da equipe.
        </p>
      </div>
    </div>
  );
}
