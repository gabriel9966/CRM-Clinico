"use client";
import { useActionState } from "react";
import { updateAccount, type AccountState } from "@/app/account/actions";
export function AccountForm({ name, email }: { name: string; email: string }) {
  const [state, action, pending] = useActionState<AccountState, FormData>(updateAccount, {});
  return <form action={action} className="modal" style={{ margin: 0, maxWidth: 640 }}><div className="modal-body">
    <div className="field"><label htmlFor="account-name">Nome</label><input id="account-name" name="name" defaultValue={name} required maxLength={100} autoComplete="name" /></div>
    <div className="field"><label htmlFor="account-email">E-mail de acesso</label><input id="account-email" value={email} readOnly type="email" /></div>
    <h2>Alterar senha</h2><p className="muted">Preencha abaixo somente se desejar trocar sua senha.</p>
    <div className="field"><label htmlFor="current-password">Senha atual</label><input id="current-password" name="currentPassword" type="password" autoComplete="current-password" /></div>
    <div className="field"><label htmlFor="profile-password">Nova senha</label><input id="profile-password" name="password" type="password" minLength={12} maxLength={72} autoComplete="new-password" /></div>
    <div className="field"><label htmlFor="profile-confirmation">Confirme a nova senha</label><input id="profile-confirmation" name="confirmation" type="password" minLength={12} maxLength={72} autoComplete="new-password" /></div>
    {state.error && <p role="alert" className="form-error">{state.error}</p>}{state.message && <p role="status">{state.message}</p>}
  </div><div className="modal-foot"><button className="btn primary" disabled={pending}>{pending ? "Salvando..." : "Salvar alterações"}</button></div></form>;
}
