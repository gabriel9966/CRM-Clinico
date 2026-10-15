import { NextRequest, NextResponse } from "next/server";
import { schedulingRoute } from "@/lib/scheduling/http";
import { deleteBlock } from "@/lib/scheduling/catalog";

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return schedulingRoute(req, async (organizationId) => {
    const { id } = await params;
    return NextResponse.json({ data: await deleteBlock(organizationId, id) });
  });
}
