import { NextRequest, NextResponse } from "next/server";
import { withApiAuth } from "@/lib/api-auth";
import { mcpListTeam } from "@/lib/mcp-tools";

export async function GET(req: NextRequest) {
  return withApiAuth(req, async (organizationId) => {
    const team = await mcpListTeam(organizationId);
    return NextResponse.json({ data: team });
  });
}
