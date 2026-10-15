import { NextRequest, NextResponse } from "next/server";
import { withApiAuth, apiError } from "@/lib/api-auth";
import { mcpSendMessage } from "@/lib/mcp-tools";

export async function POST(req: NextRequest) {
  return withApiAuth(req, async (organizationId) => {
    const body = await req.json().catch(() => null);
    if (!body?.contactId || !body?.text) return apiError("campos obrigatórios: contactId, text", 400);
    const result = await mcpSendMessage(organizationId, body.contactId, body.text);
    if (!result.ok && result.error) return apiError(result.error, 404);
    return NextResponse.json({ data: result }, { status: 201 });
  });
}
