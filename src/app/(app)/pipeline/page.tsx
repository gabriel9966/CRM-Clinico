import { getPipelines, getTeamMembers, getCustomFieldDefinitions } from "@/lib/data";
import { listLossReasons, listTags } from "@/lib/crm-catalog";
import { getPipelineBoard } from "@/lib/queries";
import { requireOrgUser } from "@/lib/auth";
import { allowedPipelineIds, hasModulePermission } from "@/lib/access";
import { PipelineBoard } from "@/components/pipeline/PipelineBoard";

export default async function PipelinePage() {
  const user = await requireOrgUser();
  const { organizationId } = user;
  const accessIds = await allowedPipelineIds(user);
  const [allPipelines, team, customFieldDefs, lossReasons, tags] = await Promise.all([
    getPipelines(organizationId),
    getTeamMembers(organizationId),
    getCustomFieldDefinitions(organizationId),
    listLossReasons(organizationId),
    listTags(organizationId, "opportunity"),
  ]);
  const pipelines = !hasModulePermission(user, "pipeline.read") ? [] : accessIds === null ? allPipelines : allPipelines.filter((pipeline) => accessIds.includes(pipeline.id));

  // Só o primeiro pipeline vem montado: totais de cada etapa (do banco) + a
  // primeira página de cartões. Trocar de pipeline e "carregar mais" são sob demanda.
  const first = pipelines[0];
  const board = first ? await getPipelineBoard(organizationId, first.id) : {};

  return (
    <PipelineBoard
      pipelines={pipelines}
      initialPipelineId={first?.id ?? ""}
      initialBoard={board}
      team={team}
      customFieldDefs={customFieldDefs}
      lossReasons={lossReasons.map((reason) => ({ id: reason.id, name: reason.name }))}
      tags={tags.map((tag) => tag.name)}
    />
  );
}
