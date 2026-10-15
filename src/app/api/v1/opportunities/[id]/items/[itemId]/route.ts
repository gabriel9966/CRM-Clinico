import { NextRequest, NextResponse } from "next/server";
import { schedulingRoute, readJson, itemUpdateSchema } from "@/lib/scheduling/http";
import { updateItem, removeItem } from "@/lib/crm-catalog";

type Ctx = { params: Promise<{ id: string; itemId: string }> };

export async function PATCH(req: NextRequest, { params }: Ctx) {
  return schedulingRoute(req, async (organizationId) => {
    const { id, itemId } = await params;
    const input = itemUpdateSchema.parse(await readJson(req));
    return NextResponse.json({ data: await updateItem(organizationId, id, itemId, input, { actorName: "API/MCP" }) });
  });
}

export async function DELETE(req: NextRequest, { params }: Ctx) {
  return schedulingRoute(req, async (organizationId) => {
    const { id, itemId } = await params;
    return NextResponse.json({ data: await removeItem(organizationId, id, itemId, { actorName: "API/MCP" }) });
  });
}
