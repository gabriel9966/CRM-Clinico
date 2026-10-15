import { NextRequest, NextResponse } from "next/server";
import { withApiAuth, apiError } from "@/lib/api-auth";
import { mcpListAppointments, mcpCreateAppointment } from "@/lib/mcp-tools";

export async function GET(req: NextRequest) {
  return withApiAuth(req, async (organizationId) => {
    const contactId = req.nextUrl.searchParams.get("contactId") ?? undefined;
    const appointments = await mcpListAppointments(organizationId, { contactId });
    return NextResponse.json({ data: appointments });
  });
}

export async function POST(req: NextRequest) {
  return withApiAuth(req, async (organizationId) => {
    const body = await req.json().catch(() => null);
    if (!body?.title || !body?.startAt || !body?.endAt) {
      return apiError("campos obrigatórios: title, startAt, endAt", 400);
    }
    const result = await mcpCreateAppointment(organizationId, body);
    return NextResponse.json({ data: result }, { status: 201 });
  });
}
