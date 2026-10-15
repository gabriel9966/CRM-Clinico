import { getTeamMembers } from "@/lib/data";
import { getActivitiesPage } from "@/lib/queries";
import { requireOrgUser } from "@/lib/auth";
import { ActivitiesView } from "@/components/activities/ActivitiesView";

export default async function ActivitiesPage() {
  const { organizationId } = await requireOrgUser();
  // Só a primeira página de tarefas pendentes; filtros e "carregar mais" vão ao servidor.
  const [page, team] = await Promise.all([
    getActivitiesPage(organizationId, { filter: "pending" }),
    getTeamMembers(organizationId),
  ]);

  return <ActivitiesView initialPage={page} team={team} />;
}
