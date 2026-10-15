import { NextRequest, NextResponse } from "next/server";
import { schedulingRoute } from "@/lib/scheduling/http";
import { listAuditLogs } from "@/lib/audit";

// GET /api/v1/audit?limit=50&cursor=<id>&entity=Contact&action=contact.&q=texto
export async function GET(req: NextRequest) {
  return schedulingRoute(req, async (organizationId) => {
    const p = req.nextUrl.searchParams;
    const limit = p.get("limit");
    const page = await listAuditLogs(organizationId, {
      cursor: p.get("cursor") ?? undefined,
      limit: limit ? Number(limit) : undefined,
      entity: p.get("entity") ?? undefined,
      action: p.get("action") ?? undefined,
      q: p.get("q") ?? undefined,
    });
    return NextResponse.json({ data: page.items, nextCursor: page.nextCursor });
  });
}
