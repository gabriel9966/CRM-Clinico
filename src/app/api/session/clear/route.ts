import { NextResponse, type NextRequest } from "next/server";

// Limpa um cookie de sessão que não serve mais e manda para o login. Casos:
// o usuário foi apagado (ou o banco recriado), o usuário não tem empresa, ou a
// empresa foi suspensa. Sem isto o proxy via uma sessão "válida" (assinatura
// ok) e mandava de /login para /, que mandava de volta para /login: loop
// infinito (ERR_TOO_MANY_REDIRECTS). Server components não podem apagar
// cookies, por isso é uma rota. Fica sob /api, fora do proxy.
export async function GET(req: NextRequest) {
  // Só repassa motivos conhecidos (nada de texto livre na URL do login).
  const error = req.nextUrl.searchParams.get("error");
  const location = error === "org_suspended" ? "/login?error=org_suspended" : "/login";

  // Location RELATIVA de propósito: atrás do nginx, req.url traz o endereço
  // interno do container (localhost:3000) e mandaria o navegador para lá.
  const res = new NextResponse(null, { status: 303, headers: { location } });
  res.cookies.delete("crm_session");
  return res;
}
