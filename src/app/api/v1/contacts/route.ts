import { NextRequest, NextResponse } from "next/server";
import { withApiAuth, apiError } from "@/lib/api-auth";
import { mcpListContacts, mcpCreateContact } from "@/lib/mcp-tools";
import { contactCreatedViaApi } from "@/lib/api-events";

export async function GET(req: NextRequest) {
  return withApiAuth(req, async (organizationId) => {
    const search = req.nextUrl.searchParams.get("search") ?? undefined;
    const contacts = await mcpListContacts(organizationId, search);
    return NextResponse.json({ data: contacts });
  });
}

export async function POST(req: NextRequest) {
  return withApiAuth(req, async (organizationId) => {
    const body = await req.json().catch(() => null);
    if (!body?.name) return apiError("campo obrigatório: name", 400);
    const contact = await mcpCreateContact(organizationId, body);
    await contactCreatedViaApi(organizationId, contact.id, Array.isArray(body.tags) ? body.tags : []);
    return NextResponse.json({ data: contact }, { status: 201 });
  });
}
