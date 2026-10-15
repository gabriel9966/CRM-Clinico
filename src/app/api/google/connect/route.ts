import { NextResponse, type NextRequest } from "next/server";
import { readSession } from "@/lib/session";
import { buildAuthUrl } from "@/lib/providers/google-calendar";

export async function GET(req: NextRequest) {
  const session = await readSession();
  if (!session) return NextResponse.redirect(new URL("/login", req.url));

  if (!process.env.GOOGLE_CLIENT_ID) {
    return NextResponse.redirect(new URL("/appointments?error=google_not_configured", req.url));
  }

  return NextResponse.redirect(buildAuthUrl(session.userId));
}
