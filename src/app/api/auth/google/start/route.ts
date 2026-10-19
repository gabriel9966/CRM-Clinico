import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { appUrl } from "@/lib/app-url";
import { buildLoginUrl, GOOGLE_LOGIN_STATE_COOKIE } from "@/lib/google-login";

export async function GET() {
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    return NextResponse.redirect(appUrl("/login?error=google_not_configured"));
  }

  const state = randomBytes(24).toString("base64url");
  const res = NextResponse.redirect(buildLoginUrl(state));
  res.cookies.set(GOOGLE_LOGIN_STATE_COOKIE, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/api/auth/google",
    maxAge: 600,
  });
  return res;
}
