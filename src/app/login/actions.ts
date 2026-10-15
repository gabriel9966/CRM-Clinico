"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { createSession } from "@/lib/session";
import { clearRateLimit, clientIp, rateLimit } from "@/lib/rate-limit";

export type LoginState = { error?: string };

// Limites contra força bruta: por e-mail (impede adivinhar a senha de uma
// conta) e por IP (impede varrer muitas contas de um mesmo lugar).
const EMAIL_LIMIT = { limit: 5, windowMs: 15 * 60_000 };
const IP_LIMIT = { limit: 30, windowMs: 15 * 60_000 };

// Hash válido usado quando o e-mail não existe, para o tempo de resposta não
// revelar quais e-mails têm conta.
const DUMMY_HASH = bcrypt.hashSync("senha-inexistente", 10);

export async function loginAction(
  _prevState: LoginState,
  formData: FormData
): Promise<LoginState> {
  const email = String(formData.get("email") || "").trim().toLowerCase();
  const password = String(formData.get("password") || "");

  if (!email || !password) {
    return { error: "Preencha e-mail e senha." };
  }

  const ip = clientIp(await headers());
  const emailKey = `login:email:${email}`;
  const byIp = rateLimit(`login:ip:${ip}`, IP_LIMIT);
  const byEmail = rateLimit(emailKey, EMAIL_LIMIT);
  if (!byIp.ok || !byEmail.ok) {
    const wait = Math.ceil(Math.max(byIp.retryAfterSec, byEmail.retryAfterSec) / 60);
    return { error: `Muitas tentativas. Tente novamente em ${wait} min.` };
  }

  const user = await prisma.user.findUnique({ where: { email }, include: { organization: true } });
  const valid = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !valid) {
    return { error: "E-mail ou senha incorretos." };
  }

  if (user.organization?.status === "SUSPENDED") {
    return { error: "O acesso da sua empresa está suspenso. Fale com o administrador da plataforma." };
  }

  clearRateLimit(emailKey);
  await createSession(user.id);
  redirect(user.isSuperAdmin ? "/admin" : "/dashboard");
}
