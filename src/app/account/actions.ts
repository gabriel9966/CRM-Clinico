"use server";
import bcrypt from "bcryptjs";
import { revalidatePath } from "next/cache";
import { requireOrgUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { createSession } from "@/lib/session";
import { actorOf, audit } from "@/lib/audit";
import { rateLimit } from "@/lib/rate-limit";
export type AccountState = { error?: string; message?: string };
export async function updateAccount(_previous: AccountState, form: FormData): Promise<AccountState> {
  const user = await requireOrgUser();
  const name = String(form.get("name") || "").trim();
  if (!name || name.length > 100) return { error: "Informe seu nome (até 100 caracteres)." };
  const password = String(form.get("password") || "");
  if (password) {
    if (!rateLimit(`password-change:${user.id}`, { limit: 5, windowMs: 15 * 60_000 }).ok) return { error: "Muitas tentativas. Aguarde alguns minutos." };
    if (!(await bcrypt.compare(String(form.get("currentPassword") || ""), user.passwordHash))) return { error: "Senha atual incorreta." };
    if (password !== String(form.get("confirmation") || "")) return { error: "As senhas não coincidem." };
    if (password.length < 12 || Buffer.byteLength(password, "utf8") > 72) return { error: "Use uma senha de pelo menos 12 caracteres e até 72 bytes." };
  }
  const saved = await prisma.user.update({ where: { id: user.id }, data: { name, ...(password ? { passwordHash: await bcrypt.hash(password, 12), sessionVersion: { increment: 1 } } : {}) } });
  if (password) await createSession(user.id, saved.sessionVersion);
  await audit(user.organizationId, { action: password ? "user.password_changed" : "user.profile_updated", entity: "User", entityId: user.id, ...actorOf(user) });
  revalidatePath("/", "layout");
  return { message: password ? "Senha atualizada. As outras sessões foram encerradas." : "Perfil atualizado." };
}
