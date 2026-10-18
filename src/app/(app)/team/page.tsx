import { getConnections, getTeamMembers, getPipelines } from "@/lib/data";
import { getOwnerStats } from "@/lib/queries";
import { requireOrgUser } from "@/lib/auth";
import { TeamView } from "@/components/team/TeamView";

export default async function TeamPage() {
  const user = await requireOrgUser();
  const [team, pipelines, connections, stats] = await Promise.all([
    getTeamMembers(user.organizationId),
    getPipelines(user.organizationId),
    getConnections(user.organizationId),
    getOwnerStats(user.organizationId),
  ]);

  return (
    <TeamView
      team={team}
      pipelines={pipelines}
      connections={connections}
      contactsByOwner={stats.contactsByOwner}
      dealsByOwnerStage={stats.dealsByOwnerStage}
      currentUserId={user.id}
    />
  );
}
