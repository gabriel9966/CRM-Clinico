import { NextRequest, NextResponse } from "next/server";
import { withApiAuth, apiError } from "@/lib/api-auth";
import { mcpSendMessage } from "@/lib/mcp-tools";

// POST { contactId, text, connectionId? } — envia por um canal real. Sem canal
// ou com o canal desconectado devolve 409 com o motivo em `error` (código) e
// `detail`; nada é gravado como "enviado".
export async function POST(req: NextRequest) {
  return withApiAuth(req, async (organizationId) => {
    const body = await req.json().catch(() => null);
    if (!body?.contactId || !body?.text) return apiError("campos obrigatórios: contactId, text", 400);
    const result = await mcpSendMessage(
      organizationId,
      body.contactId,
      body.text,
      typeof body.connectionId === "string" ? body.connectionId : undefined
    );
    if ("code" in result) {
      const status = result.code === "contato_nao_encontrado" ? 404 : result.code === "texto_vazio" ? 400 : 409;
      return NextResponse.json({ error: result.code, detail: result.error }, { status });
    }
    // 201 mesmo quando o provedor recusou (status "failed"): a mensagem foi registrada.
    return NextResponse.json({ data: result }, { status: 201 });
  });
}
