// Redefine a senha de um usuário pela linha de comando.
//   npx tsx prisma/reset-password.ts email@exemplo.com [novaSenha]
// Sem novaSenha, gera uma aleatória e imprime. Útil para trocar as senhas de
// demonstração em produção ou recuperar um acesso perdido.
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";

try {
  process.loadEnvFile(".env");
} catch {
  // já carregado ou ausente
}

const [emailArg, passwordArg] = process.argv.slice(2);
if (!emailArg) {
  console.error("Uso: npx tsx prisma/reset-password.ts <email> [novaSenha]");
  process.exit(1);
}

const email = emailArg.trim().toLowerCase();
const password = passwordArg || randomBytes(9).toString("base64url");
if (password.length < 10) {
  console.error("A senha precisa ter pelo menos 10 caracteres.");
  process.exit(1);
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });

async function main() {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    console.error(`Usuário não encontrado: ${email}`);
    process.exit(1);
  }
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await bcrypt.hash(password, 10) } });
  console.log(`Senha de ${email} redefinida.`);
  if (!passwordArg) console.log(`Nova senha: ${password}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
