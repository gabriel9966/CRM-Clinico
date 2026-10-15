import { NextRequest, NextResponse } from "next/server";
import { withApiAuth } from "@/lib/api-auth";
import { mcpListPipelines } from "@/lib/mcp-tools";

export async function GET(req: NextRequest) {
  return withApiAuth(req, async (organizationId) => {
    const pipelines = await mcpListPipelines(organizationId);
    return NextResponse.json({ data: pipelines });
  });
}
