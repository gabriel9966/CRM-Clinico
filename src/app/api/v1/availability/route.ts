import { NextRequest, NextResponse } from "next/server";
import { schedulingRoute } from "@/lib/scheduling/http";
import { getAvailability } from "@/lib/scheduling/service";

// GET /api/v1/availability?from=YYYY-MM-DD&to=YYYY-MM-DD&procedureId=…&professionalId=…
export async function GET(req: NextRequest) {
  return schedulingRoute(req, async (organizationId) => {
    const p = req.nextUrl.searchParams;
    const duration = p.get("durationMin");
    const limit = p.get("limit");
    const data = await getAvailability(organizationId, {
      from: p.get("from") ?? undefined,
      to: p.get("to") ?? undefined,
      procedureId: p.get("procedureId") ?? undefined,
      durationMin: duration ? Number(duration) : undefined,
      professionalId: p.get("professionalId") ?? undefined,
      roomId: p.get("roomId") ?? undefined,
      limit: limit ? Number(limit) : undefined,
    });
    return NextResponse.json({ data });
  });
}
