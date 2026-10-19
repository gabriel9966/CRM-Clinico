import { requireAdminPage } from "@/lib/auth";
import { getAiAgents } from "@/lib/ai/queries";
import { AiAgentsView } from "@/components/ai/AiAgentsView";

export default async function AiPage() {
  const { organizationId } = await requireAdminPage();
  const agents = await getAiAgents(organizationId);
  return <AiAgentsView agents={agents} />;
}
