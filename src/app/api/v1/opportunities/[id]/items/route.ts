import { NextRequest, NextResponse } from "next/server";
import { schedulingRoute, readJson, itemSchema } from "@/lib/scheduling/http";
import { listItems, addItem } from "@/lib/crm-catalog";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: Ctx) {
  return schedulingRoute(req, async (organizationId) => {
    const { id } = await params;
    return NextResponse.json({ data: await listItems(organizationId, id) });
  });
}

// Com procedureId, nome e preço vêm do catálogo (podem ser sobrescritos).
// O valor do negócio passa a ser a soma dos itens.
export async function POST(req: NextRequest, { params }: Ctx) {
  return schedulingRoute(req, async (organizationId) => {
    const { id } = await params;
    const input = itemSchema.parse(await readJson(req));
    return NextResponse.json({ data: await addItem(organizationId, id, input, { actorName: "API/MCP" }) }, { status: 201 });
  });
}
