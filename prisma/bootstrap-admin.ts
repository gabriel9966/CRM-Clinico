import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";

const email = process.env.BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase();
const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;
const organizationName = process.env.BOOTSTRAP_ORG_NAME?.trim();

if (process.env.NODE_ENV !== "production") throw new Error("Este bootstrap é exclusivo para produção.");
if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("BOOTSTRAP_ADMIN_EMAIL inválido.");
if (!password || password.length < 16 || Buffer.byteLength(password, "utf8") > 72) {
  throw new Error("BOOTSTRAP_ADMIN_PASSWORD deve ter ao menos 16 caracteres e no máximo 72 bytes.");
}
if (!organizationName || organizationName.length > 200) throw new Error("BOOTSTRAP_ORG_NAME inválido.");
const adminEmail = email!;
const adminPassword = password!;
const adminOrganizationName = organizationName!;

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });

async function main() {
  const organization = await prisma.$transaction(async (tx) => {
    if (await tx.user.count() !== 0) throw new Error("O bootstrap só pode ser executado quando ainda não existem usuários.");

    const createdOrganization = await tx.organization.create({
      data: { name: adminOrganizationName, slug: `inicial-${randomBytes(10).toString("hex")}` },
    });
    await tx.user.create({
      data: {
        organizationId: createdOrganization.id,
        name: "Administrador da plataforma",
        email: adminEmail,
        passwordHash: await bcrypt.hash(adminPassword, 12),
        role: "ADMIN",
        isSuperAdmin: true,
        dataScope: "all",
      },
    });
    return createdOrganization;
  }, { isolationLevel: "Serializable" });

  console.log(`Administrador inicial criado para a organização ${organization.name} (${adminEmail}).`);
}

main()
  .catch(() => {
    console.error("Bootstrap não concluído. Confira as variáveis, o acesso ao banco e se já existe algum usuário.");
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
