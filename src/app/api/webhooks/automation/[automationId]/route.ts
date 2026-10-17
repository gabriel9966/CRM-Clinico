import { NextResponse, type NextRequest } from "next/server";
import { runAutomationById } from "@/lib/automation/engine";
import { checkWebhookToken, guardWebhook } from "@/lib/webhook-auth";

// URL própria por automação (gatilho "Webhook recebido"). Qualquer sistema
// externo (n8n, um formulário, etc.) pode fazer POST aqui com um JSON
// qualquer — isso dispara o fluxo, com o corpo disponível como `payload`
// dentro do nó de Código. O id da automação na URL funciona como segredo da
// rota (mesmo padrão usado no webhook da Evolution API).
export async function POST(req: NextRequest, { params }: { params: Promise<{ automationId: string }> }) {
  const { automationId } = await params;

  const denied = guardWebhook(req, "automation", automationId);
  if (denied) return denied;
  // Automações usam sempre a URL gerada no editor; não há webhook legado
  // a preservar. Sem o token, qualquer pessoa com o id poderia executar o fluxo.
  if (checkWebhookToken(req, "automation", automationId) !== "ok") {
    return NextResponse.json({ ok: false, error: "token_required" }, { status: 401 });
  }

  let payload: unknown = null;
  try {
    payload = await req.json();
  } catch {
    payload = await req.text().catch(() => null);
  }

  const result = await runAutomationById(automationId, payload);
  if (!result.ok) {
    return NextResponse.json(result, { status: 404 });
  }
  return NextResponse.json(result);
}
