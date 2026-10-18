"use server";

import { revalidatePath } from "next/cache";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { requireAdminUser } from "@/lib/auth";
import { MODULE_PERMISSIONS } from "@/lib/access";
import { actorOf, audit } from "@/lib/audit";

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
  // Contas novas nunca herdam o acesso amplo do comportamento legado. O
  // administrador precisa liberar módulos, pipelines e instâncias na matriz.
  await prisma.user.create({ data: { name, email, passwordHash, color, team, organizationId, accessConfigured: true, permissions: "[]" } });
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

export type TeamAccessInput = {
  role: "ADMIN" | "MEMBER";
  permissions: string[];
  pipelineAccesses: { pipelineId: string; canEdit: boolean }[];
  connectionAccesses: { connectionId: string; canSend: boolean }[];
};

/** Salva a matriz de acesso de um membro. IDs vindos da tela são validados na
 * organização antes da gravação; a lista vazia é deliberadamente restritiva. */
export async function updateTeamMemberAccess(id: string, input: TeamAccessInput) {
  const current = await requireAdminUser();
  if (current.id === id) return { error: "Para evitar perda de acesso, outro administrador deve alterar suas permissões." };
  const target = await prisma.user.findFirst({ where: { id, organizationId: current.organizationId }, select: { id: true } });
  if (!target) return { error: "Membro não encontrado." };

  const permissions = [...new Set(input.permissions)].filter((permission) => (MODULE_PERMISSIONS as readonly string[]).includes(permission));
  const pipelineIds = [...new Set(input.pipelineAccesses.map((access) => access.pipelineId).filter(Boolean))];
  const connectionIds = [...new Set(input.connectionAccesses.map((access) => access.connectionId).filter(Boolean))];
  const [pipelineCount, connectionCount] = await Promise.all([
    prisma.pipeline.count({ where: { organizationId: current.organizationId, id: { in: pipelineIds } } }),
    prisma.connection.count({ where: { organizationId: current.organizationId, id: { in: connectionIds } } }),
  ]);
  if (pipelineCount !== pipelineIds.length || connectionCount !== connectionIds.length) return { error: "Há um pipeline ou instância inválida na seleção." };

  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id }, data: { role: input.role, permissions: JSON.stringify(permissions), accessConfigured: input.role !== "ADMIN" } });
    await tx.userPipelineAccess.deleteMany({ where: { userId: id } });
    await tx.userConnectionAccess.deleteMany({ where: { userId: id } });
    if (input.role === "MEMBER") {
      if (pipelineIds.length) await tx.userPipelineAccess.createMany({ data: pipelineIds.map((pipelineId) => ({ userId: id, pipelineId, canView: true, canEdit: input.pipelineAccesses.find((access) => access.pipelineId === pipelineId)?.canEdit ?? false })) });
      if (connectionIds.length) await tx.userConnectionAccess.createMany({ data: connectionIds.map((connectionId) => ({ userId: id, connectionId, canView: true, canSend: input.connectionAccesses.find((access) => access.connectionId === connectionId)?.canSend ?? false })) });
    }
  });
  await audit(current.organizationId, { action: "team.access_updated", entity: "User", entityId: id, ...actorOf(current), meta: { role: input.role, permissions, pipelines: pipelineIds, connections: connectionIds } });
  revalidatePath("/team");
  revalidatePath("/pipeline");
  revalidatePath("/conversations");
  return { ok: true };
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
