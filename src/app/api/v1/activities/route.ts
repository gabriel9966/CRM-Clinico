import { NextRequest, NextResponse } from "next/server";
import { withApiAuth, apiError } from "@/lib/api-auth";
import { mcpListActivities, mcpCreateActivity } from "@/lib/mcp-tools";

export async function GET(req: NextRequest) {
  return withApiAuth(req, async (organizationId) => {
    const sp = req.nextUrl.searchParams;
    const doneParam = sp.get("done");
    const activities = await mcpListActivities(organizationId, {
      contactId: sp.get("contactId") ?? undefined,
      opportunityId: sp.get("opportunityId") ?? undefined,
      done: doneParam === null ? undefined : doneParam === "true",
    });
    return NextResponse.json({ data: activities });
  });
}

export async function POST(req: NextRequest) {
  return withApiAuth(req, async (organizationId) => {
    const body = await req.json().catch(() => null);
    if (!body?.title || !body?.dueAt) return apiError("campos obrigatórios: title, dueAt", 400);
    const result = await mcpCreateActivity(organizationId, body);
    return NextResponse.json({ data: result }, { status: 201 });
  });
}
