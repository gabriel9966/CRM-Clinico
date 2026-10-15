import "server-only";
import { prisma } from "@/lib/prisma";
import { encryptJson, decryptJson } from "@/lib/crypto";

// Integração com o Google Calendar via OAuth2 + REST (sem SDK pesado).
// Cada atendente conecta a própria conta (ver /connections/google e a
// tela de Agendamentos) — não é uma conta fixa da plataforma.

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const CALENDAR_API = "https://www.googleapis.com/calendar/v3";
const SCOPE = "https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/userinfo.email";

function redirectUri() {
  const base = (process.env.APP_BASE_URL || "http://localhost:3000").replace(/\/+$/, "");
  return `${base}/api/google/callback`;
}

export function buildAuthUrl(state: string) {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID || "",
    redirect_uri: redirectUri(),
    response_type: "code",
    scope: SCOPE,
    access_type: "offline",
    prompt: "consent",
    state,
  });
  return `${AUTH_URL}?${params.toString()}`;
}

export async function exchangeCodeForTokens(code: string) {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID || "",
      client_secret: process.env.GOOGLE_CLIENT_SECRET || "",
      redirect_uri: redirectUri(),
      grant_type: "authorization_code",
      code,
    }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error_description || json.error || "Falha ao trocar código por tokens");
  return json as { access_token: string; refresh_token?: string; expires_in: number };
}

async function refreshAccessToken(refreshToken: string) {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID || "",
      client_secret: process.env.GOOGLE_CLIENT_SECRET || "",
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error_description || json.error || "Falha ao renovar token do Google");
  return json as { access_token: string; expires_in: number };
}

// Garante um access_token válido para o usuário, renovando via refresh_token
// se estiver perto de expirar. Retorna null se a pessoa nunca conectou.
export async function getValidAccessToken(userId: string): Promise<string | null> {
  const account = await prisma.googleAccount.findUnique({ where: { userId } });
  if (!account) return null;

  const expiresInMs = account.expiresAt.getTime() - Date.now();
  if (expiresInMs > 60_000) {
    return decryptJson<string>(account.accessToken);
  }

  const refreshToken = decryptJson<string>(account.refreshToken);
  const refreshed = await refreshAccessToken(refreshToken);
  const newExpiresAt = new Date(Date.now() + refreshed.expires_in * 1000);

  await prisma.googleAccount.update({
    where: { userId },
    data: {
      accessToken: encryptJson(refreshed.access_token),
      expiresAt: newExpiresAt,
    },
  });

  return refreshed.access_token;
}

export type CalendarEventInput = {
  title: string;
  notes?: string | null;
  startAt: Date;
  endAt: Date;
  attendeeEmail?: string | null;
};

export async function createCalendarEvent(userId: string, input: CalendarEventInput): Promise<string | null> {
  const token = await getValidAccessToken(userId);
  if (!token) return null;
  const account = await prisma.googleAccount.findUnique({ where: { userId } });
  const calendarId = account?.calendarId || "primary";

  const res = await fetch(`${CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      summary: input.title,
      description: input.notes || undefined,
      start: { dateTime: input.startAt.toISOString() },
      end: { dateTime: input.endAt.toISOString() },
      attendees: input.attendeeEmail ? [{ email: input.attendeeEmail }] : undefined,
    }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error?.message || "Falha ao criar evento no Google Calendar");
  return json.id as string;
}

export async function updateCalendarEvent(userId: string, eventId: string, input: CalendarEventInput) {
  const token = await getValidAccessToken(userId);
  if (!token) return;
  const account = await prisma.googleAccount.findUnique({ where: { userId } });
  const calendarId = account?.calendarId || "primary";

  await fetch(`${CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events/${eventId}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      summary: input.title,
      description: input.notes || undefined,
      start: { dateTime: input.startAt.toISOString() },
      end: { dateTime: input.endAt.toISOString() },
    }),
  });
}

export async function deleteCalendarEvent(userId: string, eventId: string) {
  const token = await getValidAccessToken(userId);
  if (!token) return;
  const account = await prisma.googleAccount.findUnique({ where: { userId } });
  const calendarId = account?.calendarId || "primary";

  await fetch(`${CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events/${eventId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  }).catch(() => {});
}
