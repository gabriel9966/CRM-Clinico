import { NextRequest, NextResponse } from "next/server";
import { schedulingRoute, readJson, roomSchema } from "@/lib/scheduling/http";
import { listRooms, createRoom } from "@/lib/scheduling/catalog";

export async function GET(req: NextRequest) {
  return schedulingRoute(req, async (organizationId) => NextResponse.json({ data: await listRooms(organizationId) }));
}

export async function POST(req: NextRequest) {
  return schedulingRoute(req, async (organizationId) => {
    const input = roomSchema.parse(await readJson(req));
    return NextResponse.json({ data: await createRoom(organizationId, input) }, { status: 201 });
  });
}
