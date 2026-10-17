"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon } from "./icons";
import { logoutAction } from "@/app/logout/actions";
import { initials } from "@/lib/format";

export function AdminSidebar({
  userName,
  hasOrg,
}: {
  userName: string;
  hasOrg: boolean;
}) {
  const pathname = usePathname();

  return (
    <div className="sidebar">
      <div className="brand">
        <span className="brand-mark" aria-hidden="true">
          <svg viewBox="0 0 28 28" fill="none">
            <path d="M7 20V8l14 12V8" stroke="currentColor" strokeWidth="2.7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
        <span className="brand-name">NovaCRM</span>
      </div>
      <div className="org-badge">Painel da Plataforma</div>
      <div style={{ flex: 1, overflowY: "auto" }}>
        <div className="nav-section-label">Plataforma</div>
        <Link href="/admin" aria-label="Empresas" title="Empresas" className={`nav-item ${pathname.startsWith("/admin") ? "active" : ""}`}>
          <Icon.team /> <span className="nav-label">Empresas</span>
        </Link>
        {hasOrg && (
          <>
            <div className="nav-section-label">Minha empresa</div>
            <Link href="/dashboard" aria-label="Ir para o CRM" title="Ir para o CRM" className="nav-item">
              <Icon.dashboard /> <span className="nav-label">Ir para o CRM</span>
            </Link>
          </>
        )}
      </div>
      <div className="sidebar-footer">Acesso de super-administrador</div>
      <div className="sidebar-user">
        <span className="avatar" style={{ background: "var(--text)", width: 26, height: 26, fontSize: 11 }}>
          {initials(userName)}
        </span>
        <span style={{ flex: 1, fontSize: 12, fontWeight: 600, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{userName}</span>
        <form action={logoutAction}>
          <button type="submit">Sair</button>
        </form>
      </div>
    </div>
  );
}
