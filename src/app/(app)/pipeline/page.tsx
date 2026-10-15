import { getPipelines, getTeamMembers, getCustomFieldDefinitions } from "@/lib/data";
import { getPipelineBoard } from "@/lib/queries";
import { requireOrgUser } from "@/lib/auth";
import { PipelineBoard } from "@/components/pipeline/PipelineBoard";

export default async function PipelinePage() {
  const { organizationId } = await requireOrgUser();
  const [pipelines, team, customFieldDefs] = await Promise.all([
    getPipelines(organizationId),
    getTeamMembers(organizationId),
    getCustomFieldDefinitions(organizationId),
  ]);

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
    />
  );
}
