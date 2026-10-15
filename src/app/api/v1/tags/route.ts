import { NextRequest, NextResponse } from "next/server";
import { schedulingRoute, readJson, tagSchema } from "@/lib/scheduling/http";
import { listTags, createTag } from "@/lib/crm-catalog";

export async function GET(req: NextRequest) {
  return schedulingRoute(req, async (organizationId) => NextResponse.json({ data: await listTags(organizationId) }));
}

export async function POST(req: NextRequest) {
  return schedulingRoute(req, async (organizationId) => {
    const input = tagSchema.parse(await readJson(req));
    return NextResponse.json({ data: await createTag(organizationId, input, { actorName: "API/MCP" }) }, { status: 201 });
  });
}
