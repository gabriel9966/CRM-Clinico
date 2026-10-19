"use server";
import { headers } from "next/headers";
import { prisma } from "@/lib/prisma";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { issuePasswordReset, consumePasswordReset } from "@/lib/password-recovery";
import { decryptJson } from "@/lib/crypto";
import { sendText, type EmailConfig } from "@/lib/providers/email";

export type RecoveryState = { error?: string; message?: string; done?: boolean };
export async function requestPasswordReset(_previous: RecoveryState, form: FormData): Promise<RecoveryState> {
  const email = String(form.get("email") || "").trim().toLowerCase().slice(0, 254);
  const ip = clientIp(await headers());
  if (!rateLimit(`recovery:${ip}`, { limit: 5, windowMs: 15 * 60_000 }).ok || !rateLimit(`recovery-email:${email}`, { limit: 3, windowMs: 30 * 60_000 }).ok) return { error: "Aguarde alguns minutos antes de solicitar outro link." };
  const user = await prisma.user.findUnique({ where: { email }, include: { organization: true } });
  if (user?.isActive && user.organizationId && user.organization?.status === "ACTIVE") {
    const connection = await prisma.connection.findFirst({ where: { organizationId: user.organizationId, provider: "EMAIL", status: "CONNECTED" } });
    const base = process.env.APP_BASE_URL;
    if (connection && base) {
      try {
        const token = await issuePasswordReset(user.id);
        const url = new URL(`/reset-password?token=${token}`, base).toString();
        await sendText(decryptJson<EmailConfig>(connection.config), email, `Use este link para definir sua senha do NovaCRM. Ele expira em 30 minutos e funciona uma única vez.\n\n${url}\n\nSe você não solicitou, ignore esta mensagem.`, "Recuperação de senha — NovaCRM");
      } catch { console.error("[password-recovery] Não foi possível enviar o e-mail de recuperação."); }
    }
  }
  return { done: true, message: "Se a conta existir e houver e-mail configurado, você receberá um link. Confira a caixa de spam. Se não receber, fale com o administrador." };
}
export async function resetPassword(_previous: RecoveryState, form: FormData): Promise<RecoveryState> {
  if (!rateLimit(`reset:${clientIp(await headers())}`, { limit: 10, windowMs: 15 * 60_000 }).ok) return { error: "Muitas tentativas. Aguarde alguns minutos." };
  if (form.get("password") !== form.get("confirmation")) return { error: "As senhas não coincidem." };
  try { await consumePasswordReset(String(form.get("token") || ""), String(form.get("password") || "")); }
  catch (failure) { return { error: failure instanceof Error ? failure.message : "Não foi possível atualizar a senha." }; }
  return { done: true, message: "Senha atualizada. As sessões anteriores foram encerradas. Entre com sua nova senha." };
}
