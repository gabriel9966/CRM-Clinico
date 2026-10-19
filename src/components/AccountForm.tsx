"use client";
import { useActionState, useEffect, useRef, useState } from "react";
import { updateAccount, type AccountState } from "@/app/account/actions";

const FIELD_ID: Record<NonNullable<AccountState["field"]>, string> = {
  name: "account-name",
  currentPassword: "current-password",
  password: "profile-password",
  confirmation: "profile-confirmation",
};

export function AccountForm({ name, email }: { name: string; email: string }) {
  const [state, action, pending] = useActionState<AccountState, FormData>(updateAccount, {});
  // Nome controlado: o React limpa campos não controlados após a ação, e um erro
  // de senha fazia o nome digitado voltar ao valor antigo.
  const [nameValue, setNameValue] = useState(name);
  const errorRef = useRef<HTMLParagraphElement>(null);

  // Leva o foco ao campo com problema (ou à mensagem) para o erro não passar despercebido.
  useEffect(() => {
    if (!state.error) return;
    const input = state.field ? document.getElementById(FIELD_ID[state.field]) : null;
    if (input instanceof HTMLInputElement) input.focus();
    else errorRef.current?.focus();
  }, [state]);

  const invalid = (field: NonNullable<AccountState["field"]>) => (state.error && state.field === field ? true : undefined);

  return <form action={action} className="modal" style={{ margin: 0, maxWidth: 640 }}><div className="modal-body">
    <div className="field"><label htmlFor="account-name">Nome</label><input id="account-name" name="name" value={nameValue} onChange={(e) => setNameValue(e.target.value)} required maxLength={100} autoComplete="name" aria-invalid={invalid("name")} /></div>
    <div className="field"><label htmlFor="account-email">E-mail de acesso</label><input id="account-email" value={email} readOnly type="email" /></div>
    <h2>Alterar senha</h2><p className="muted">Preencha abaixo somente se desejar trocar sua senha.</p>
    <div className="field"><label htmlFor="current-password">Senha atual</label><input id="current-password" name="currentPassword" type="password" autoComplete="current-password" aria-invalid={invalid("currentPassword")} aria-describedby={state.error ? "account-error" : undefined} /></div>
    <div className="field"><label htmlFor="profile-password">Nova senha</label><input id="profile-password" name="password" type="password" minLength={12} maxLength={72} autoComplete="new-password" aria-invalid={invalid("password")} aria-describedby={state.error ? "account-error" : undefined} /></div>
    <div className="field"><label htmlFor="profile-confirmation">Confirme a nova senha</label><input id="profile-confirmation" name="confirmation" type="password" minLength={12} maxLength={72} autoComplete="new-password" aria-invalid={invalid("confirmation")} aria-describedby={state.error ? "account-error" : undefined} /></div>
    {state.error && <p id="account-error" ref={errorRef} tabIndex={-1} role="alert" className="form-error">{state.error}</p>}{state.message && <p role="status">{state.message}</p>}
  </div><div className="modal-foot"><button className="btn primary" disabled={pending}>{pending ? "Salvando..." : "Salvar alterações"}</button></div></form>;
}
