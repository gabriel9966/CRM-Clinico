import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { encryptJson } from "@/lib/crypto";
import { exchangeCodeForTokens } from "@/lib/providers/google-calendar";

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const code = searchParams.get("code");
  const userId = searchParams.get("state"); // id do usuário que iniciou o fluxo (veio de /api/google/connect)
  const error = searchParams.get("error");

  if (error || !code || !userId) {
    return NextResponse.redirect(new URL("/appointments?error=google_auth_failed", req.url));
  }

  try {
    const tokens = await exchangeCodeForTokens(code);
    if (!tokens.refresh_token) {
      // Sem refresh_token normalmente significa que a pessoa já tinha autorizado antes
      // e o Google não reemitiu um novo. Pedimos pra revogar o acesso em
      // myaccount.google.com/permissions e tentar conectar de novo.
      return NextResponse.redirect(new URL("/appointments?error=google_no_refresh_token", req.url));
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

    return NextResponse.redirect(new URL("/appointments?connected=1", req.url));
  } catch {
    return NextResponse.redirect(new URL("/appointments?error=google_auth_failed", req.url));
  }
}
