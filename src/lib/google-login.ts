import "server-only";

// "Entrar com Google": só identifica a pessoa (OpenID, e-mail). Não cria
// contas — o e-mail precisa pertencer a um usuário ativo já cadastrado.
// Usa o mesmo cliente OAuth do Google Agenda, com outra URL de retorno.

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";

export const GOOGLE_LOGIN_STATE_COOKIE = "google_login_state";
const GOOGLE_TIMEOUT_MS = 10_000;

function redirectUri() {
  const base = (process.env.APP_BASE_URL || "http://localhost:3000").replace(/\/+$/, "");
  return `${base}/api/auth/google/callback`;
}

export function buildLoginUrl(state: string) {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID || "",
    redirect_uri: redirectUri(),
    response_type: "code",
    scope: "openid email",
    prompt: "select_account",
    state,
  });
  return `${AUTH_URL}?${params.toString()}`;
}

// Troca o código e devolve o e-mail verificado da conta Google (ou null).
export async function verifiedEmailFromCode(code: string): Promise<string | null> {
  const res = await fetch(TOKEN_URL, {
    signal: AbortSignal.timeout(GOOGLE_TIMEOUT_MS),
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
  if (!res.ok) return null;
  const { access_token } = (await res.json()) as { access_token?: string };
  if (!access_token) return null;

  const me = await fetch(USERINFO_URL, { headers: { Authorization: `Bearer ${access_token}` }, signal: AbortSignal.timeout(GOOGLE_TIMEOUT_MS) });
  if (!me.ok) return null;
  const info = (await me.json()) as { email?: string; email_verified?: boolean };
  if (!info.email || info.email_verified !== true) return null;
  return info.email.trim().toLowerCase();
}
