import { NextRequest, NextResponse } from "next/server";
import { withApiAuth, apiError } from "@/lib/api-auth";
import { mcpListOpportunities, mcpCreateOpportunity } from "@/lib/mcp-tools";
import { opportunityCreatedViaApi } from "@/lib/api-events";

export async function GET(req: NextRequest) {
  return withApiAuth(req, async (organizationId) => {
    const sp = req.nextUrl.searchParams;
    const opportunities = await mcpListOpportunities(organizationId, {
      pipelineId: sp.get("pipelineId") ?? undefined,
      stageId: sp.get("stageId") ?? undefined,
      contactId: sp.get("contactId") ?? undefined,
    });
    return NextResponse.json({ data: opportunities });
  });
}

export async function POST(req: NextRequest) {
  return withApiAuth(req, async (organizationId) => {
    const body = await req.json().catch(() => null);
    if (!body?.title || !body?.contactId || !body?.pipelineId || !body?.stageId) {
      return apiError("campos obrigatórios: title, contactId, pipelineId, stageId", 400);
    }
    const result = await mcpCreateOpportunity(organizationId, body);
    if ("error" in result) return apiError(result.error!, 404);
    await opportunityCreatedViaApi(organizationId, result.id);
    return NextResponse.json({ data: result }, { status: 201 });
  });
}
