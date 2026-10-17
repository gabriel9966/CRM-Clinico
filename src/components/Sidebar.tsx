"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon } from "./icons";
import { logoutAction } from "@/app/logout/actions";
import { initials } from "@/lib/format";
import { GlobalSearch } from "@/components/shared/GlobalSearch";

const NAV_GROUPS = [
  {
    label: "Visão geral",
    items: [
      { href: "/dashboard", label: "Dashboard", icon: Icon.dashboard },
      { href: "/pipeline", label: "Pipeline", icon: Icon.pipeline },
      { href: "/contacts", label: "Contatos", icon: Icon.contacts },
      { href: "/conversations", label: "Conversas", icon: Icon.chat },
      { href: "/campaigns", label: "Campanhas", icon: Icon.zap, adminOnly: true },
    ],
  },
  {
    label: "Agenda",
    items: [
      { href: "/activities", label: "Tarefas", icon: Icon.tasks },
      { href: "/appointments", label: "Agendamentos", icon: Icon.calendar },
    ],
  },
  {
    label: "Configurações",
    items: [
      { href: "/team", label: "Equipe", icon: Icon.team },
      { href: "/connections", label: "Conexões", icon: Icon.plug, adminOnly: true },
      { href: "/automations", label: "Automações", icon: Icon.zap, adminOnly: true },
      { href: "/tags", label: "Tags", icon: Icon.settings, adminOnly: true },
      { href: "/custom-fields", label: "Campos extras", icon: Icon.settings },
      { href: "/mcp", label: "Integração MCP", icon: Icon.api, adminOnly: true },
    ],
  },
];

// Só administradores da empresa veem estes itens (as telas e ações também
// conferem o papel no servidor).
const ADMIN_ITEMS = [
  { href: "/trash", label: "Lixeira", icon: Icon.trash, adminOnly: true },
  { href: "/audit", label: "Auditoria", icon: Icon.tasks, adminOnly: true },
];

export function Sidebar({
  userName,
  userColor,
  orgName,
  isSuperAdmin,
  isAdmin,
}: {
  userName: string;
  userColor: string;
  orgName: string;
  isSuperAdmin?: boolean;
  isAdmin?: boolean;
}) {
  const pathname = usePathname();
  // Atendente comum não vê os itens de administração (as páginas também são
  // bloqueadas no servidor — esconder o link é só para não levar a um beco sem saída).
  const groups = NAV_GROUPS.map((g) => {
    const items: { href: string; label: string; icon: typeof Icon.dashboard; adminOnly?: boolean }[] =
      g.label === "Configurações" ? [...g.items, ...ADMIN_ITEMS] : g.items;
    return { ...g, items: items.filter((it) => !it.adminOnly || isAdmin) };
  });

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
      <div className="org-badge">{orgName}</div>
      <div style={{ padding: "0 12px 8px" }}>
        <GlobalSearch />
      </div>
      <div style={{ flex: 1, overflowY: "auto" }}>
        {groups.map((group) => (
          <div key={group.label}>
            <div className="nav-section-label">{group.label}</div>
            {group.items.map((item) => {
              const active = pathname.startsWith(item.href);
              const ItemIcon = item.icon;
              return (
                <Link key={item.href} href={item.href} aria-label={item.label} title={item.label} className={`nav-item ${active ? "active" : ""}`}>
                  <ItemIcon /> <span className="nav-label">{item.label}</span>
                </Link>
              );
            })}
          </div>
        ))}
        {isSuperAdmin && (
          <div>
            <div className="nav-section-label">Plataforma</div>
            <Link href="/admin" aria-label="Painel da Plataforma" title="Painel da Plataforma" className="nav-item">
              <Icon.team /> <span className="nav-label">Painel da Plataforma</span>
            </Link>
          </div>
        )}
      </div>
      <div className="sidebar-footer">Dados salvos no banco · multiusuário</div>
      <div className="sidebar-user">
        <span className="avatar" style={{ background: userColor, width: 26, height: 26, fontSize: 11 }}>
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
