import { NextRequest, NextResponse } from "next/server";
import { schedulingRoute, readJson, procedureSchema } from "@/lib/scheduling/http";
import { listProcedures, createProcedure } from "@/lib/scheduling/catalog";

export async function GET(req: NextRequest) {
  return schedulingRoute(req, async (organizationId) =>
    NextResponse.json({ data: await listProcedures(organizationId) })
  );
}

export async function POST(req: NextRequest) {
  return schedulingRoute(req, async (organizationId) => {
    const input = procedureSchema.parse(await readJson(req));
    return NextResponse.json({ data: await createProcedure(organizationId, input) }, { status: 201 });
  });
}
