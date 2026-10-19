import { getTeamMembers } from "@/lib/data";
import { getTaskBoard } from "@/lib/task-board";
import { requireOrgUser } from "@/lib/auth";
import { ActivitiesView } from "@/components/activities/ActivitiesView";
import { hasModulePermission } from "@/lib/access";

export default async function ActivitiesPage() {
  const user = await requireOrgUser();
  if (!hasModulePermission(user, "agenda.read")) return <div className="content"><h1>Tarefas</h1><p>Você não tem acesso a este módulo. Solicite a liberação ao administrador.</p></div>;
  const { organizationId } = user;
  const [lists, team] = await Promise.all([getTaskBoard(organizationId, { participantId: user.id }), getTeamMembers(organizationId)]);

  return <ActivitiesView initialLists={lists} team={team} currentUserId={user.id} />;
}
