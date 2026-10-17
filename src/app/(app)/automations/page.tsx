import { getAutomations, getAutomationRuns } from "@/lib/data";
import { requireAdminPage } from "@/lib/auth";
import { AutomationsView } from "@/components/automations/AutomationsView";

export default async function AutomationsPage() {
  const { organizationId } = await requireAdminPage();
  const [automations, runs] = await Promise.all([getAutomations(organizationId), getAutomationRuns(organizationId)]);
  return <AutomationsView automations={automations} runs={runs} />;
}
