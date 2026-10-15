import { NextRequest, NextResponse } from "next/server";
import { schedulingRoute, readJson, rescheduleSchema } from "@/lib/scheduling/http";
import { rescheduleAppointment } from "@/lib/scheduling/service";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return schedulingRoute(req, async (organizationId) => {
    const { id } = await params;
    const input = rescheduleSchema.parse(await readJson(req));
    return NextResponse.json({ data: await rescheduleAppointment(organizationId, id, input) });
  });
}
