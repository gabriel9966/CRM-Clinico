import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { encryptJson } from "@/lib/crypto";
import { readSession } from "@/lib/session";
import { appUrl } from "@/lib/app-url";
import { exchangeCodeForTokens, GOOGLE_STATE_COOKIE } from "@/lib/providers/google-calendar";

function sameState(a: string | null | undefined, b: string | null | undefined) {
  if (!a || !b) return false;
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

function redirectTo(path: string) {
  const res = NextResponse.redirect(appUrl(path));
  res.cookies.set(GOOGLE_STATE_COOKIE, "", { path: "/api/google", maxAge: 0 });
  return res;
}

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const code = searchParams.get("code");
  const error = searchParams.get("error");

  const session = await readSession();
  if (!session) return redirectTo("/login");
  const userId = session.userId;

  if (error || !code || !sameState(searchParams.get("state"), req.cookies.get(GOOGLE_STATE_COOKIE)?.value)) {
    return redirectTo("/appointments?error=google_auth_failed");
  }

  try {
    const tokens = await exchangeCodeForTokens(code);
    if (!tokens.refresh_token) {
      // Sem refresh_token normalmente significa que a pessoa já tinha autorizado antes
      // e o Google não reemitiu um novo. Pedimos pra revogar o acesso em
      // myaccount.google.com/permissions e tentar conectar de novo.
      return redirectTo("/appointments?error=google_no_refresh_token");
    }

    let email: string | null = null;
    try {
      const me = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      }).then((r) => r.json());
      email = me.email ?? null;
    } catch {
      email = null;
    }

    await prisma.googleAccount.upsert({
      where: { userId },
      create: {
        userId,
        accessToken: encryptJson(tokens.access_token),
        refreshToken: encryptJson(tokens.refresh_token),
        expiresAt: new Date(Date.now() + tokens.expires_in * 1000),
        email,
      },
      update: {
        accessToken: encryptJson(tokens.access_token),
        refreshToken: encryptJson(tokens.refresh_token),
        expiresAt: new Date(Date.now() + tokens.expires_in * 1000),
        email,
      },
    });

    return redirectTo("/appointments?connected=1");
  } catch {
    return redirectTo("/appointments?error=google_auth_failed");
  }
}
