import { NextRequest, NextResponse } from "next/server";
import { schedulingRoute, readJson, restoreSchema } from "@/lib/scheduling/http";
import { listTrash, restore } from "@/lib/trash";

// Lista o que foi apagado (recuperável).
export async function GET(req: NextRequest) {
  return schedulingRoute(req, async (organizationId) => NextResponse.json({ data: await listTrash(organizationId) }));
}

// Restaura um item. Excluir definitivamente NÃO é exposto na API por chave —
// só pela tela, com usuário ADMIN autenticado.
export async function POST(req: NextRequest) {
  return schedulingRoute(req, async (organizationId) => {
    const { entity, id } = restoreSchema.parse(await readJson(req));
    await restore(organizationId, entity, id, { actorName: "API/MCP" });
    return NextResponse.json({ data: { ok: true } });
  });
}
