import { NextRequest, NextResponse } from "next/server";
import { schedulingRoute, readJson, professionalSchema } from "@/lib/scheduling/http";
import { listProfessionals, createProfessional } from "@/lib/scheduling/catalog";

export async function GET(req: NextRequest) {
  return schedulingRoute(req, async (organizationId) =>
    NextResponse.json({ data: await listProfessionals(organizationId) })
  );
}

export async function POST(req: NextRequest) {
  return schedulingRoute(req, async (organizationId) => {
    const input = professionalSchema.parse(await readJson(req));
    return NextResponse.json({ data: await createProfessional(organizationId, input) }, { status: 201 });
  });
}
