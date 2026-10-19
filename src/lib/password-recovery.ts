import "server-only";
import { createHash, randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { prisma } from "./prisma";

export async function issuePasswordReset(userId: string) {
  const token = randomBytes(32).toString("hex");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  await prisma.$transaction(async (tx) => {
    await tx.passwordResetToken.deleteMany({ where: { userId } });
    await tx.passwordResetToken.create({ data: { userId, tokenHash, expiresAt: new Date(Date.now() + 30 * 60_000) } });
  });
  return token;
}

export async function consumePasswordReset(token: string, password: string) {
  if (!/^[a-f0-9]{64}$/.test(token) || password.length < 12 || Buffer.byteLength(password, "utf8") > 72) throw new Error("Informe uma senha entre 12 e 72 bytes e um link válido.");
  const hash = createHash("sha256").update(token).digest("hex");
  const passwordHash = await bcrypt.hash(password, 12);
  await prisma.$transaction(async (tx) => {
    const reset = await tx.passwordResetToken.findUnique({ where: { tokenHash: hash }, include: { user: { include: { organization: true } } } });
    if (!reset || reset.expiresAt <= new Date() || !reset.user.isActive || reset.user.organization?.status === "SUSPENDED") throw new Error("O link expirou ou já foi utilizado. Solicite outro link.");
    // Single-use claim: simultaneous requests cannot both change the password.
    const claimed = await tx.passwordResetToken.deleteMany({ where: { id: reset.id, expiresAt: { gt: new Date() } } });
    if (claimed.count !== 1) throw new Error("O link já foi utilizado.");
    await tx.user.update({ where: { id: reset.userId }, data: { passwordHash, sessionVersion: { increment: 1 } } });
    await tx.passwordResetToken.deleteMany({ where: { userId: reset.userId } });
  });
}
