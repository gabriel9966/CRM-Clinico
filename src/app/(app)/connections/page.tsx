import { getConnections } from "@/lib/data";
import { requireAdminPage } from "@/lib/auth";
import { ConnectionsView } from "@/components/connections/ConnectionsView";

export default async function ConnectionsPage() {
  const { organizationId } = await requireAdminPage();
  const connections = await getConnections(organizationId);
  return <ConnectionsView connections={connections} />;
}
