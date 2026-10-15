import { NextRequest, NextResponse } from "next/server";
import { schedulingRoute, readJson, bookSchema } from "@/lib/scheduling/http";
import { bookAppointment } from "@/lib/scheduling/service";

// POST /api/v1/appointments/book — agenda com validação de disponibilidade.
// Aceita idempotencyKey (repetir a chamada devolve o mesmo agendamento) e
// dryRun (valida sem gravar).
export async function POST(req: NextRequest) {
  return schedulingRoute(req, async (organizationId) => {
    const input = bookSchema.parse(await readJson(req));
    const result = await bookAppointment(organizationId, input);
    const created = "id" in result && !result.idempotent;
    return NextResponse.json({ data: result }, { status: created ? 201 : 200 });
  });
}
