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
  const target = new URL("/login", req.url);
  if (error === "org_suspended") target.searchParams.set("error", error);

  const res = NextResponse.redirect(target, 303);
  res.cookies.delete("crm_session");
  return res;
}
