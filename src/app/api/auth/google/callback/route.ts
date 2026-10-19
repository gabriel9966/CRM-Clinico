import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { createSession } from "@/lib/session";
import { appUrl } from "@/lib/app-url";
import { clientIp } from "@/lib/rate-limit";
import { sharedRateLimit } from "@/lib/shared-rate-limit";
import { GOOGLE_LOGIN_STATE_COOKIE, verifiedEmailFromCode } from "@/lib/google-login";

const IP_LIMIT = { limit: 30, windowMs: 15 * 60_000 };

function sameState(a: string | null | undefined, b: string | null | undefined) {
  if (!a || !b) return false;
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

function redirectTo(path: string) {
  const res = NextResponse.redirect(appUrl(path));
  res.cookies.set(GOOGLE_LOGIN_STATE_COOKIE, "", { path: "/api/auth/google", maxAge: 0 });
  return res;
}

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const code = searchParams.get("code");

  if (searchParams.get("error") || !code || !sameState(searchParams.get("state"), req.cookies.get(GOOGLE_LOGIN_STATE_COOKIE)?.value)) {
    return redirectTo("/login?error=google_failed");
  }

  const rl = await sharedRateLimit(`login:ip:${clientIp(req.headers)}`, IP_LIMIT);
  if (!rl.ok) return redirectTo("/login?error=google_rate_limited");

  let email: string | null;
  try {
    email = await verifiedEmailFromCode(code);
  } catch {
    email = null;
  }
  if (!email) return redirectTo("/login?error=google_failed");

  // Mesmas regras do login por senha: usuário existente, ativo e com a
  // empresa não suspensa. Não revela se o e-mail tem conta ou está inativo.
  const user = await prisma.user.findUnique({ where: { email }, include: { organization: true } });
  if (!user || !user.isActive) return redirectTo("/login?error=google_no_account");
  if (user.organization?.status === "SUSPENDED") return redirectTo("/login?error=suspended");

  await createSession(user.id, user.sessionVersion);
  return redirectTo(user.isSuperAdmin ? "/admin" : "/dashboard");
}
