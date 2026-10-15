import { NextRequest, NextResponse } from "next/server";
import { schedulingRoute, readJson, tagUpdateSchema } from "@/lib/scheduling/http";
import { updateTag, deleteTag } from "@/lib/crm-catalog";

type Ctx = { params: Promise<{ id: string }> };

// Renomear propaga para todos os contatos e negócios que usam a etiqueta.
export async function PATCH(req: NextRequest, { params }: Ctx) {
  return schedulingRoute(req, async (organizationId) => {
    const { id } = await params;
    const input = tagUpdateSchema.parse(await readJson(req));
    return NextResponse.json({ data: await updateTag(organizationId, id, input, { actorName: "API/MCP" }) });
  });
}

// Excluir remove a etiqueta de todos os registros que a usam.
export async function DELETE(req: NextRequest, { params }: Ctx) {
  return schedulingRoute(req, async (organizationId) => {
    const { id } = await params;
    return NextResponse.json({ data: await deleteTag(organizationId, id, { actorName: "API/MCP" }) });
  });
}
