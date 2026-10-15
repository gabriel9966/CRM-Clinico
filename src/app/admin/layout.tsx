import { requireSuperAdmin } from "@/lib/auth";
import { AdminSidebar } from "@/components/AdminSidebar";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await requireSuperAdmin();

  return (
    <div id="app-shell">
      <AdminSidebar userName={user.name} hasOrg={!!user.organizationId} />
      <div className="main">{children}</div>
    </div>
  );
}
