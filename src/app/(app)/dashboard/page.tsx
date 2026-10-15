import { getPipelines, getTeamMembers } from "@/lib/data";
import { getDashboardAggregates } from "@/lib/queries";
import { requireOrgUser } from "@/lib/auth";
import { DashboardView } from "@/components/dashboard/DashboardView";

export default async function DashboardPage() {
  const { organizationId } = await requireOrgUser();
  // Os totais são somados no banco; a tela nunca carrega a lista de negócios.
  const [pipelines, team, data] = await Promise.all([
    getPipelines(organizationId),
    getTeamMembers(organizationId),
    getDashboardAggregates(organizationId),
  ]);

  return <DashboardView pipelines={pipelines} data={data} team={team} />;
}
