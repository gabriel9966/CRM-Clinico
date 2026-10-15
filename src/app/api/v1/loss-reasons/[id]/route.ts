import { NextRequest, NextResponse } from "next/server";
import { schedulingRoute, readJson, lossReasonUpdateSchema } from "@/lib/scheduling/http";
import { updateLossReason, deleteLossReason } from "@/lib/crm-catalog";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, { params }: Ctx) {
  return schedulingRoute(req, async (organizationId) => {
    const { id } = await params;
    const input = lossReasonUpdateSchema.parse(await readJson(req));
    return NextResponse.json({ data: await updateLossReason(organizationId, id, input) });
  });
}

// Se o motivo já foi usado em algum negócio, é só desativado (preserva relatórios).
export async function DELETE(req: NextRequest, { params }: Ctx) {
  return schedulingRoute(req, async (organizationId) => {
    const { id } = await params;
    return NextResponse.json({ data: await deleteLossReason(organizationId, id) });
  });
}
