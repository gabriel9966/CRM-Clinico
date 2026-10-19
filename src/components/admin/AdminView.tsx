"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icons";
import type { OrganizationWithStats } from "@/lib/admin-data";
import { createOrganization, setOrganizationStatus, type CreateOrgState } from "@/app/admin/actions";

const initialState: CreateOrgState = {};

export function AdminView({ organizations }: { organizations: OrganizationWithStats[] }) {
  const router = useRouter();
  const [modalOpen, setModalOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [state, formAction, pending] = useActionState(createOrganization, initialState);
  const wasPending = useRef(false);

  useEffect(() => {
    if (wasPending.current && !pending && !state.error) {
      setModalOpen(false);
      router.refresh();
    }
    wasPending.current = pending;
  }, [pending, state, router]);

  async function toggleStatus(orgId: string, current: "ACTIVE" | "SUSPENDED") {
    setBusyId(orgId);
    try {
      await setOrganizationStatus(orgId, current === "ACTIVE" ? "SUSPENDED" : "ACTIVE");
      router.refresh();
    } finally {
      setBusyId(null);
    }
  }

  const totalUsers = organizations.reduce((s, o) => s + o.userCount, 0);
  const totalContacts = organizations.reduce((s, o) => s + o.contactCount, 0);

  return (
    <>
      <div className="topbar">
        <div>
          <h1>Empresas</h1>
          <div className="sub">Todos os clientes (tenants) da plataforma</div>
        </div>
        <button className="btn primary" onClick={() => setModalOpen(true)}>
          <Icon.plus /> Nova empresa
        </button>
      </div>

      <div className="content">
      <div className="stats-row">
        <div className="stat-card">
          <div className="label">Empresas</div>
          <div className="value">{organizations.length}</div>
          <div className="delta">{organizations.filter((o) => o.status === "ACTIVE").length} ativas</div>
        </div>
        <div className="stat-card">
          <div className="label">Usuários</div>
          <div className="value">{totalUsers}</div>
          <div className="delta">em todas as empresas</div>
        </div>
        <div className="stat-card">
          <div className="label">Contatos</div>
          <div className="value">{totalContacts}</div>
          <div className="delta">em todas as empresas</div>
        </div>
      </div>

      {organizations.length === 0 ? (
        <div className="empty-state"><Icon.team /><div>Nenhuma empresa cadastrada ainda</div></div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Empresa</th><th>Usuários</th><th>Contatos</th><th>Oportunidades</th><th>Status</th><th></th></tr>
            </thead>
            <tbody>
              {organizations.map((o) => (
                <tr key={o.id} className="row" style={{ cursor: "default" }}>
                  <td style={{ fontWeight: 700 }}>
                    {o.name}
                    <div className="muted" style={{ fontSize: 11, fontWeight: 500 }}>{o.slug}</div>
                  </td>
                  <td>{o.userCount}</td>
                  <td>{o.contactCount}</td>
                  <td>{o.opportunityCount}</td>
                  <td>
                    <span className="pill" style={{ background: o.status === "ACTIVE" ? "var(--green-soft)" : "var(--red-soft)", color: o.status === "ACTIVE" ? "var(--green)" : "var(--red)" }}>
                      {o.status === "ACTIVE" ? "Ativa" : "Suspensa"}
                    </span>
                  </td>
                  <td style={{ textAlign: "right" }}>
                    <button
                      className={`btn small ${o.status === "ACTIVE" ? "danger" : ""}`}
                      disabled={busyId === o.id}
                      onClick={() => toggleStatus(o.id, o.status)}
                    >
                      {o.status === "ACTIVE" ? "Suspender" : "Reativar"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      </div>

      {modalOpen && (
        <div className="modal-overlay" onClick={() => setModalOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h2>Nova empresa</h2>
              <button className="close-x" onClick={() => setModalOpen(false)}><Icon.close /></button>
            </div>
            <form action={formAction}>
              <div className="modal-body">
                <div className="field">
                  <label>Nome da empresa *</label>
                  <input name="orgName" required placeholder="Ex: Acme Ltda" autoFocus />
                </div>
                <p className="muted" style={{ fontSize: 11, margin: "0 0 12px" }}>
                  Isso já cria o primeiro usuário administrador dessa empresa, com um pipeline padrão.
                </p>
                <div className="field">
                  <label>Nome do administrador *</label>
                  <input name="adminName" required placeholder="Ex: Maria Silva" />
                </div>
                <div className="field">
                  <label>E-mail do administrador *</label>
                  <input name="adminEmail" type="email" required placeholder="maria@acme.com" />
                </div>
                <div className="field">
                  <label>Senha provisória *</label>
                  <input name="adminPassword" type="password" required minLength={12} maxLength={72} placeholder="mínimo 12 caracteres" />
                </div>
                {state.error && <p style={{ color: "var(--red)", fontSize: 13, fontWeight: 600 }}>{state.error}</p>}
              </div>
              <div className="modal-foot">
                <button type="button" className="btn" onClick={() => setModalOpen(false)}>Cancelar</button>
                <button type="submit" className="btn primary" disabled={pending}>
                  {pending ? "Criando..." : "Criar empresa"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
