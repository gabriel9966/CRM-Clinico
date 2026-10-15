import { NextRequest, NextResponse } from "next/server";
import { schedulingRoute, readJson, blockSchema } from "@/lib/scheduling/http";
import { listBlocks, createBlock } from "@/lib/scheduling/catalog";

export async function GET(req: NextRequest) {
  return schedulingRoute(req, async (organizationId) =>
    NextResponse.json({
      data: await listBlocks(organizationId, req.nextUrl.searchParams.get("professionalId") ?? undefined),
    })
  );
}

export async function POST(req: NextRequest) {
  return schedulingRoute(req, async (organizationId) => {
    const input = blockSchema.parse(await readJson(req));
    return NextResponse.json({ data: await createBlock(organizationId, input) }, { status: 201 });
  });
}
