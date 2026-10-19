import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { readSession } from "@/lib/session";
import { appUrl } from "@/lib/app-url";
import { buildAuthUrl, GOOGLE_STATE_COOKIE } from "@/lib/providers/google-calendar";

export async function GET() {
  const session = await readSession();
  if (!session) return NextResponse.redirect(appUrl("/login"));

  if (!process.env.GOOGLE_CLIENT_ID) {
    return NextResponse.redirect(appUrl("/appointments?error=google_not_configured"));
  }

  // state aleatório amarrado a este navegador: o callback só aceita o retorno
  // se o cookie bater, e usa o usuário da sessão (nunca o que vier na URL).
  const state = randomBytes(24).toString("base64url");
  const res = NextResponse.redirect(buildAuthUrl(state));
  res.cookies.set(GOOGLE_STATE_COOKIE, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/api/google",
    maxAge: 600,
  });
  return res;
}
