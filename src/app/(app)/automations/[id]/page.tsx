import { notFound } from "next/navigation";
import { getAutomation, getPipelines, getTeamMembers } from "@/lib/data";
import { requireAdminPage } from "@/lib/auth";
import { FlowEditor } from "@/components/automations/FlowEditor";
import { webhookToken } from "@/lib/webhook-auth";
import { listProfessionals, listProcedures } from "@/lib/scheduling/catalog";

export default async function AutomationEditorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { organizationId } = await requireAdminPage();
  const [automation, pipelines, team, professionals, procedures] = await Promise.all([
    getAutomation(id, organizationId),
    getPipelines(organizationId),
    getTeamMembers(organizationId),
    listProfessionals(organizationId),
    listProcedures(organizationId),
  ]);

  if (!automation) notFound();

  const webhookPath = `/api/webhooks/automation/${automation.id}?token=${webhookToken("automation", automation.id)}`;
  return <FlowEditor automation={automation} pipelines={pipelines} team={team} professionals={professionals.map((item) => ({ id: item.id, name: item.name }))} procedures={procedures.map((item) => ({ id: item.id, name: item.name }))} webhookPath={webhookPath} />;
}
