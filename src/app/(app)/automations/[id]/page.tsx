import { notFound } from "next/navigation";
import { getAutomation, getPipelines, getTeamMembers } from "@/lib/data";
import { requireAdminPage } from "@/lib/auth";
import { FlowEditor } from "@/components/automations/FlowEditor";
import { webhookToken } from "@/lib/webhook-auth";

export default async function AutomationEditorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { organizationId } = await requireAdminPage();
  const [automation, pipelines, team] = await Promise.all([
    getAutomation(id, organizationId),
    getPipelines(organizationId),
    getTeamMembers(organizationId),
  ]);

  if (!automation) notFound();

  const webhookPath = `/api/webhooks/automation/${automation.id}?token=${webhookToken("automation", automation.id)}`;
  return <FlowEditor automation={automation} pipelines={pipelines} team={team} webhookPath={webhookPath} />;
}
