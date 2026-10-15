import { requireOrgUser } from "@/lib/auth";
import { Sidebar } from "@/components/Sidebar";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireOrgUser();

  return (
    <div id="app-shell">
      <Sidebar
        userName={user.name}
        userColor={user.color}
        orgName={user.organization.name}
        isSuperAdmin={user.isSuperAdmin}
        isAdmin={user.role === "ADMIN"}
      />
      <div className="main">{children}</div>
    </div>
  );
}
