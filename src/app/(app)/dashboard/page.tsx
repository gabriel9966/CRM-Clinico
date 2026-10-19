import { getPipelines, getTeamMembers } from "@/lib/data";
import { getDashboardAggregates } from "@/lib/queries";
import { requireOrgUser } from "@/lib/auth";
import { DashboardView } from "@/components/dashboard/DashboardView";
import { allowedPipelineIds, allowedConnectionIds, getOwnerScope, hasModulePermission } from "@/lib/access";

export default async function DashboardPage() {
  const user = await requireOrgUser();
  const { organizationId } = user;
  if (!hasModulePermission(user, "reports.read")) return <div className="content"><h1>Bem-vindo, {user.name}</h1><p>Seu acesso está ativo. Peça ao administrador que libere os módulos e relatórios necessários para seu trabalho.</p></div>;
  const [pipelineIds, connectionIds, owners] = await Promise.all([allowedPipelineIds(user), allowedConnectionIds(user), getOwnerScope(user)]);
  // Os totais são somados no banco; a tela nunca carrega a lista de negócios.
  const [pipelines, team, data] = await Promise.all([
    getPipelines(organizationId).then((items) => pipelineIds ? items.filter((item) => pipelineIds.includes(item.id)) : items),
    getTeamMembers(organizationId),
    getDashboardAggregates(organizationId, { pipelineIds, connectionIds, owners, ownerId: owners ? user.id : undefined }),
  ]);

  return <DashboardView pipelines={pipelines} data={data} team={team} />;
}
