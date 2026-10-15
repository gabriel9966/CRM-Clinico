import { NextRequest, NextResponse } from "next/server";
import { schedulingRoute, readJson, procedureUpdateSchema } from "@/lib/scheduling/http";
import { updateProcedure } from "@/lib/scheduling/catalog";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, { params }: Ctx) {
  return schedulingRoute(req, async (organizationId) => {
    const { id } = await params;
    const input = procedureUpdateSchema.parse(await readJson(req));
    return NextResponse.json({ data: await updateProcedure(organizationId, id, input) });
  });
}

// Arquivar (active=false) em vez de apagar: agendamentos e negócios antigos
// continuam apontando para o procedimento.
export async function DELETE(req: NextRequest, { params }: Ctx) {
  return schedulingRoute(req, async (organizationId) => {
    const { id } = await params;
    return NextResponse.json({ data: await updateProcedure(organizationId, id, { active: false }) });
  });
}
