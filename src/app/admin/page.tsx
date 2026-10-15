import { getOrganizationsWithStats } from "@/lib/admin-data";
import { AdminView } from "@/components/admin/AdminView";

export default async function AdminPage() {
  const organizations = await getOrganizationsWithStats();
  return <AdminView organizations={organizations} />;
}
