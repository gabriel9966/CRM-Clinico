import { NextRequest, NextResponse } from "next/server";
import { schedulingRoute, readJson, lossSchema } from "@/lib/scheduling/http";
import { setOpportunityLossReason } from "@/lib/crm-catalog";

// POST { lossReasonId: "..." } marca o motivo de perda; { lossReasonId: null } limpa.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return schedulingRoute(req, async (organizationId) => {
    const { id } = await params;
    const { lossReasonId } = lossSchema.parse(await readJson(req));
    return NextResponse.json({ data: await setOpportunityLossReason(organizationId, id, lossReasonId) });
  });
}
