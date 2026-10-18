import { requireOrgUser } from "@/lib/auth";
import { getTeamMembers, getPipelines } from "@/lib/data";
import { prisma } from "@/lib/prisma";
import { csvDownload } from "@/lib/export";
import { audit, actorOf } from "@/lib/audit";
import { allowedPipelineIds, hasModulePermission } from "@/lib/access";

const BATCH = 1000;

function parseTags(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function GET() {
  const user = await requireOrgUser();
  if (!hasModulePermission(user, "pipeline.read") || !hasModulePermission(user, "data.import_export")) {
    return new Response("Sem permissão para exportar oportunidades.", { status: 403 });
  }
  const { organizationId } = user;
  const permittedPipelineIds = await allowedPipelineIds(user);
  const [team, allPipelines] = await Promise.all([getTeamMembers(organizationId), getPipelines(organizationId)]);
  const pipelines = permittedPipelineIds === null ? allPipelines : allPipelines.filter((pipeline) => permittedPipelineIds.includes(pipeline.id));

  const ownerName = (id: string | null) => (id ? team.find((m) => m.id === id)?.name ?? "" : "");
  const pipelineName = (id: string) => pipelines.find((p) => p.id === id)?.name ?? "";
  const stageLabel = (pipelineId: string, stageId: string) =>
    pipelines.find((p) => p.id === pipelineId)?.stages.find((s) => s.id === stageId)?.label ?? "";

  await audit(organizationId, { action: "opportunity.exported", entity: "Opportunity", ...actorOf(user) });

  const columns = ["title", "value", "contact_name", "contact_email", "contact_phone", "pipeline", "stage", "owner", "tags", "expected_close", "loss_reason"];
  return csvDownload("oportunidades.csv", columns, async (cursor) => {
    // O contato vem junto na mesma consulta (JOIN), sem carregar a base de contatos.
    const rows = await prisma.opportunity.findMany({
      where: { organizationId, ...(permittedPipelineIds === null ? {} : { pipelineId: { in: permittedPipelineIds } }) },
      include: { contact: { select: { name: true, email: true, phone: true } } },
      orderBy: { id: "asc" },
      take: BATCH + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    const hasMore = rows.length > BATCH;
    const page = hasMore ? rows.slice(0, BATCH) : rows;
    return {
      rows: page.map((o) => ({
        title: o.title,
        value: o.value,
        contact_name: o.contact?.name ?? "",
        contact_email: o.contact?.email ?? "",
        contact_phone: o.contact?.phone ?? "",
        pipeline: pipelineName(o.pipelineId),
        stage: stageLabel(o.pipelineId, o.stageId),
        owner: ownerName(o.ownerId),
        tags: parseTags(o.tags).join(";"),
        expected_close: o.expectedClose ? o.expectedClose.toISOString().slice(0, 10) : "",
        loss_reason: o.lossReason ?? "",
      })),
      next: hasMore ? page[page.length - 1].id : null,
    };
  });
}
