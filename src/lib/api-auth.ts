import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { resolveOrgByMcpApiKey } from "./mcp-config";
import { clientIp } from "./rate-limit";
import { sharedRateLimit } from "./shared-rate-limit";
import { AppError } from "./errors";

// Autenticação da API REST pública (/api/v1/*): mesma chave usada no MCP
// (gerenciada na tela "Integração MCP"), enviada como Authorization: Bearer <chave>.
// Cada chave resolve pra uma organização — todo dado lido/escrito fica isolado a ela.

export async function resolveApiOrg(req: NextRequest): Promise<string | null> {
  const auth = req.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) return null;
  return resolveOrgByMcpApiKey(token);
}

export function apiError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

function rateLimited(retryAfterSec: number) {
  return NextResponse.json(
    { error: "rate_limited" },
    { status: 429, headers: { "Retry-After": String(retryAfterSec) } }
  );
}

export async function withApiAuth(
  req: NextRequest,
  handler: (organizationId: string) => Promise<NextResponse>
): Promise<NextResponse> {
  // Limite por IP antes de consultar o banco: barra tentativa de adivinhar
  // chaves. Depois de autenticado, limite por organização.
  const ip = clientIp(req.headers);
  const ipLimit = await sharedRateLimit(`api:ip:${ip}`, { limit: 300, windowMs: 60_000 });
  if (!ipLimit.ok) return rateLimited(ipLimit.retryAfterSec);

  const organizationId = await resolveApiOrg(req);
  if (!organizationId) return apiError("unauthorized", 401);

  const orgLimit = await sharedRateLimit(`api:org:${organizationId}`, { limit: 600, windowMs: 60_000 });
  if (!orgLimit.ok) return rateLimited(orgLimit.retryAfterSec);
  try {
    return await handler(organizationId);
  } catch (err) {
    // Erro de regra de negócio (ex.: id de outra organização) → resposta clara, não 500.
    if (err instanceof AppError) {
      return NextResponse.json({ error: err.code, detail: err.message }, { status: err.status });
    }
    console.error("[api/v1] erro:", err);
    return apiError("internal_error", 500);
  }
}
