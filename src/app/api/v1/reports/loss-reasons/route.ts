import { NextRequest, NextResponse } from "next/server";
import { schedulingRoute } from "@/lib/scheduling/http";
import { lossReasonReport } from "@/lib/crm-catalog";

export async function GET(req: NextRequest) {
  return schedulingRoute(req, async (organizationId) => NextResponse.json({ data: await lossReasonReport(organizationId) }));
}
