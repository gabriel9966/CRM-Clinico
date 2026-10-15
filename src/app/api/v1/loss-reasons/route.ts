import { NextRequest, NextResponse } from "next/server";
import { schedulingRoute, readJson, lossReasonSchema } from "@/lib/scheduling/http";
import { listLossReasons, createLossReason } from "@/lib/crm-catalog";

export async function GET(req: NextRequest) {
  return schedulingRoute(req, async (organizationId) =>
    NextResponse.json({ data: await listLossReasons(organizationId, req.nextUrl.searchParams.get("all") === "1") })
  );
}

export async function POST(req: NextRequest) {
  return schedulingRoute(req, async (organizationId) => {
    const input = lossReasonSchema.parse(await readJson(req));
    return NextResponse.json({ data: await createLossReason(organizationId, input, { actorName: "API/MCP" }) }, { status: 201 });
  });
}
