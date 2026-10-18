import { getTeamMembers } from "@/lib/data";
import { getTaskBoard } from "@/lib/task-board";
import { requireOrgUser } from "@/lib/auth";
import { ActivitiesView } from "@/components/activities/ActivitiesView";

export default async function ActivitiesPage() {
  const user = await requireOrgUser();
  const { organizationId } = user;
  const [lists, team] = await Promise.all([getTaskBoard(organizationId, { participantId: user.id }), getTeamMembers(organizationId)]);

  return <ActivitiesView initialLists={lists} team={team} currentUserId={user.id} />;
}
