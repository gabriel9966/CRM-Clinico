"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon } from "./icons";
import { logoutAction } from "@/app/logout/actions";
import { initials } from "@/lib/format";
import { useSidebarState } from "./useSidebarState";

export function AdminSidebar({
  userName,
  hasOrg,
}: {
  userName: string;
  hasOrg: boolean;
}) {
  const pathname = usePathname();
  const sidebar = useSidebarState(pathname);

  return (
    <>
    {sidebar.isMobile && sidebar.mobileOpen && <button type="button" className="sidebar-backdrop" aria-label="Fechar menu" onClick={sidebar.closeMobile} />}
    <button type="button" className="mobile-menu-btn" onClick={sidebar.toggle} aria-label={sidebar.mobileOpen ? "Fechar menu" : "Abrir menu"} aria-controls="crm-navigation" aria-expanded={sidebar.mobileOpen}>
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
    </button>
    <aside className={`sidebar ${sidebar.isCompact ? "is-compact" : ""} ${sidebar.mobileOpen ? "mobile-open" : ""}`}>
      <div className="brand">
        <span className="brand-mark" aria-hidden="true">
          <span className="brand-glyph">&lt;/&gt;</span>
        </span>
        <span className="brand-copy"><span className="brand-name">NovaCRM</span><span className="brand-byline">by Kodexx</span></span>
        <button type="button" className="sidebar-toggle" onClick={sidebar.toggle} aria-label={sidebar.expanded ? "Fechar menu" : "Abrir menu"} aria-expanded={sidebar.expanded} aria-controls="crm-navigation" title={sidebar.expanded ? "Fechar menu" : "Abrir menu"}>
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d={sidebar.expanded ? "m14.5 6-6 6 6 6" : "m9.5 6 6 6-6 6"} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
      </div>
      <div className="org-badge">Painel da Plataforma</div>
      <nav id="crm-navigation" className="sidebar-nav" aria-label="Menu principal">
        <div className="nav-section-label">Plataforma</div>
        <Link href="/admin" aria-label="Empresas" title="Empresas" onClick={sidebar.closeMobile} className={`nav-item ${pathname.startsWith("/admin") ? "active" : ""}`}>
          <Icon.team /> <span className="nav-label">Empresas</span>
        </Link>
        {hasOrg && (
          <>
            <div className="nav-section-label">Minha empresa</div>
            <Link href="/dashboard" aria-label="Ir para o CRM" title="Ir para o CRM" onClick={sidebar.closeMobile} className="nav-item">
              <Icon.dashboard /> <span className="nav-label">Ir para o CRM</span>
            </Link>
          </>
        )}
      </nav>
      <div className="sidebar-footer">Acesso de super-administrador</div>
      <div className="sidebar-user">
        <span className="avatar" style={{ background: "var(--text)", width: 26, height: 26, fontSize: 11 }}>
          {initials(userName)}
        </span>
        <span style={{ flex: 1, fontSize: 12, fontWeight: 600, color: "var(--sidebar-heading)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{userName}</span>
        <form action={logoutAction}>
          <button type="submit">Sair</button>
        </form>
      </div>
    </aside>
    </>
  );
}
