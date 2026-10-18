import { getTeamMembers } from "@/lib/data";
import { getTaskBoard } from "@/lib/task-board";
import { requireOrgUser } from "@/lib/auth";
import { ActivitiesView } from "@/components/activities/ActivitiesView";

export default async function ActivitiesPage() {
  const { organizationId } = await requireOrgUser();
  const [lists, team] = await Promise.all([getTaskBoard(organizationId), getTeamMembers(organizationId)]);

  return <ActivitiesView initialLists={lists} team={team} />;
}
