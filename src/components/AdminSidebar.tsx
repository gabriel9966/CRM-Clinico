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
        <span className="dot" /> NovaCRM
      </div>
      <div className="org-badge">Painel da Plataforma</div>
      <div style={{ flex: 1, overflowY: "auto" }}>
        <div className="nav-section-label">Plataforma</div>
        <Link href="/admin" className={`nav-item ${pathname.startsWith("/admin") ? "active" : ""}`}>
          <Icon.team /> Empresas
        </Link>
        {hasOrg && (
          <>
            <div className="nav-section-label">Minha empresa</div>
            <Link href="/dashboard" className="nav-item">
              <Icon.dashboard /> Ir para o CRM
            </Link>
          </>
        )}
      </div>
      <div className="sidebar-footer">Acesso de super-administrador</div>
      <div className="sidebar-user">
        <span className="avatar" style={{ background: "#4f46e5", width: 26, height: 26, fontSize: 11 }}>
          {initials(userName)}
        </span>
        <span style={{ flex: 1, fontSize: 12, fontWeight: 600, color: "#d7d9e3" }}>{userName}</span>
        <form action={logoutAction}>
          <button type="submit">Sair</button>
        </form>
      </div>
    </div>
  );
}
