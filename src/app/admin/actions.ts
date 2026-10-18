"use server";

import { revalidatePath } from "next/cache";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { requireSuperAdmin } from "@/lib/auth";

export type CreateOrgState = { error?: string };

function slugify(name: string) {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

const DEFAULT_STAGES = [
  { label: "Novo Lead", color: "#64748b", status: "OPEN" as const },
  { label: "Contato Feito", color: "#2563eb", status: "OPEN" as const },
  { label: "Proposta Enviada", color: "#7c3aed", status: "OPEN" as const },
  { label: "Negociação", color: "#ea580c", status: "OPEN" as const },
  { label: "Ganho", color: "#16a34a", status: "WON" as const },
  { label: "Perdido", color: "#dc2626", status: "LOST" as const },
];

export async function createOrganization(
  _prev: CreateOrgState,
  formData: FormData
): Promise<CreateOrgState> {
  await requireSuperAdmin();

  const orgName = String(formData.get("orgName") || "").trim();
  const adminName = String(formData.get("adminName") || "").trim();
  const adminEmail = String(formData.get("adminEmail") || "").trim().toLowerCase();
  const adminPassword = String(formData.get("adminPassword") || "");

  if (!orgName || !adminName || !adminEmail || !adminPassword) {
    return { error: "Preencha todos os campos." };
  }
  if (adminPassword.length < 6) {
    return { error: "A senha precisa ter pelo menos 6 caracteres." };
  }

  const existingUser = await prisma.user.findUnique({ where: { email: adminEmail } });
  if (existingUser) {
    return { error: "Já existe um usuário com esse e-mail." };
  }

  let slug = slugify(orgName) || "empresa";
  let suffix = 1;
  while (await prisma.organization.findUnique({ where: { slug } })) {
    suffix += 1;
    slug = `${slugify(orgName)}-${suffix}`;
  }

  const passwordHash = await bcrypt.hash(adminPassword, 10);

  await prisma.organization.create({
    data: {
      name: orgName,
      slug,
      users: { create: { name: adminName, email: adminEmail, passwordHash, role: "ADMIN" } },
      pipelines: {
        create: {
          name: "Vendas",
          stages: { create: DEFAULT_STAGES.map((s, i) => ({ ...s, order: i })) },
        },
      },
    },
  });

  revalidatePath("/admin");
  return {};
}

export async function setOrganizationStatus(organizationId: string, status: "ACTIVE" | "SUSPENDED") {
  await requireSuperAdmin();
  await prisma.organization.update({ where: { id: organizationId }, data: { status } });
  revalidatePath("/admin");
}
