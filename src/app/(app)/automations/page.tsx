import { getAutomations } from "@/lib/data";
import { requireAdminPage } from "@/lib/auth";
import { AutomationsView } from "@/components/automations/AutomationsView";

export default async function AutomationsPage() {
  const { organizationId } = await requireAdminPage();
  const automations = await getAutomations(organizationId);
  return <AutomationsView automations={automations} />;
}
