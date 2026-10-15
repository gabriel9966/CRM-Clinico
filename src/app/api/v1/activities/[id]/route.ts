import { NextRequest, NextResponse } from "next/server";
import { withApiAuth, apiError } from "@/lib/api-auth";
import { mcpUpdateActivity, mcpDeleteActivity } from "@/lib/mcp-tools";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withApiAuth(req, async (organizationId) => {
    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    const result = await mcpUpdateActivity(organizationId, id, body);
    if ("error" in result) return apiError(result.error!, 404);
    return NextResponse.json({ data: result });
  });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withApiAuth(req, async (organizationId) => {
    const { id } = await params;
    const result = await mcpDeleteActivity(organizationId, id);
    if (!result.ok) return apiError(result.error!, 404);
    return NextResponse.json({ data: result });
  });
}
