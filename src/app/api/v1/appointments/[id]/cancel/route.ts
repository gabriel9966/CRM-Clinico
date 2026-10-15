import { NextRequest, NextResponse } from "next/server";
import { schedulingRoute, readJson, reasonSchema } from "@/lib/scheduling/http";
import { cancelAppointment } from "@/lib/scheduling/service";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return schedulingRoute(req, async (organizationId) => {
    const { id } = await params;
    const { reason } = reasonSchema.parse((await readJson(req)) ?? {});
    return NextResponse.json({ data: await cancelAppointment(organizationId, id, { reason }) });
  });
}
