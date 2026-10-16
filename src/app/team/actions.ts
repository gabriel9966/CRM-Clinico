"use server";

import { revalidatePath } from "next/cache";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { requireAdminUser } from "@/lib/auth";

export type TeamMemberState = { error?: string };

export async function createTeamMember(
  _prev: TeamMemberState,
  formData: FormData
): Promise<TeamMemberState> {
  const { organizationId } = await requireAdminUser();
  const name = String(formData.get("name") || "").trim();
  const email = String(formData.get("email") || "").trim().toLowerCase();
  const password = String(formData.get("password") || "");
  const color = String(formData.get("color") || "#4f46e5");
  const team = String(formData.get("team") || "Geral").trim().slice(0, 60) || "Geral";

  if (!name || !email || !password) {
    return { error: "Preencha nome, e-mail e senha." };
  }
  if (password.length < 6) {
    return { error: "A senha precisa ter pelo menos 6 caracteres." };
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return { error: "Já existe um usuário com esse e-mail." };
  }

  const passwordHash = await bcrypt.hash(password, 10);
  await prisma.user.create({ data: { name, email, passwordHash, color, team, organizationId } });
  revalidatePath("/team");
  return {};
}

export async function updateTeamMember(
  id: string,
  data: { name: string; color: string; team: string }
) {
  const { organizationId } = await requireAdminUser();
  await prisma.user.updateMany({ where: { id, organizationId }, data: { name: data.name, color: data.color, team: data.team.trim().slice(0, 60) || "Geral" } });
  revalidatePath("/team");
}

// Membro inativo (ex: de férias) sai do rodízio de atribuição automática
// (ver assignNextOwner em lib/assignment.ts) sem precisar excluir a conta.
export async function toggleTeamMemberActive(id: string, isActive: boolean) {
  const { organizationId } = await requireAdminUser();
  await prisma.user.updateMany({ where: { id, organizationId }, data: { isActive } });
  revalidatePath("/team");
}

export async function deleteTeamMember(id: string) {
  const current = await requireAdminUser();
  if (current.id === id) return { error: "Você não pode excluir a si mesmo." };

  const target = await prisma.user.findFirst({ where: { id, organizationId: current.organizationId } });
  if (!target) return { error: "Membro não encontrado." };

  await prisma.$transaction([
    prisma.contact.updateMany({ where: { ownerId: id }, data: { ownerId: null } }),
    prisma.opportunity.updateMany({ where: { ownerId: id }, data: { ownerId: null } }),
    prisma.user.delete({ where: { id } }),
  ]);
  revalidatePath("/team");
  return {};
}
