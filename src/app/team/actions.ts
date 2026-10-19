"use server";

import { revalidatePath } from "next/cache";
import bcrypt from "bcryptjs";
import { prisma, type TxClient } from "@/lib/prisma";
import { requireAdminUser } from "@/lib/auth";
import { MODULE_PERMISSIONS } from "@/lib/access";
import { isDataScope } from "@/lib/access-scope";
import { actorOf, audit } from "@/lib/audit";

export type TeamMemberState = { error?: string };

export async function createTeamMember(
  _prev: TeamMemberState,
  formData: FormData
): Promise<TeamMemberState> {
  const current = await requireAdminUser();
  const { organizationId } = current;
  const name = String(formData.get("name") || "").trim();
  const email = String(formData.get("email") || "").trim().toLowerCase();
  const password = String(formData.get("password") || "");
  const color = String(formData.get("color") || "#4f46e5");
  const team = String(formData.get("team") || "Geral").trim().slice(0, 60) || "Geral";

  if (!name || !email || !password) {
    return { error: "Preencha nome, e-mail e senha." };
  }
  if (password.length < 12 || Buffer.byteLength(password, "utf8") > 72) {
    return { error: "Use uma senha de pelo menos 12 caracteres e até 72 bytes." };
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return { error: "Já existe um usuário com esse e-mail." };
  }

  // Acessos escolhidos já no cadastro (perfil, carteira, pipelines, instâncias).
  // Sem eles, a conta nasce sem nenhum módulo liberado (restritiva).
  let access: TeamAccessInput | null = null;
  const rawAccess = formData.get("access");
  if (typeof rawAccess === "string" && rawAccess) {
    try { access = JSON.parse(rawAccess) as TeamAccessInput; } catch { return { error: "Acessos inválidos." }; }
  }
  const checked = access ? await validateAccess(organizationId, access) : null;
  if (checked && "error" in checked) return { error: checked.error };

  const passwordHash = await bcrypt.hash(password, 12);
  const created = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({ data: { name, email, passwordHash, color, team, organizationId, accessConfigured: true, permissions: "[]", dataScope: "own" } });
    if (checked) await applyAccess(tx, user.id, checked);
    return user;
  });
  await audit(organizationId, { action: "team.created", entity: "User", entityId: created.id, ...actorOf(current), meta: { team, ...(checked ? { role: checked.role, dataScope: checked.dataScope, permissions: checked.permissions, pipelines: checked.pipelineIds, connections: checked.connectionIds } : {}) } });
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
  /** Carteira: "own" (só os dele) | "team" (da equipe) | "all" (todos). */
  dataScope: "own" | "team" | "all";
  /** Vê também os registros sem responsável (fila de novos leads). */
  seeUnassigned: boolean;
};

type CheckedAccess = { role: "ADMIN" | "MEMBER"; permissions: string[]; dataScope: "own" | "team" | "all"; seeUnassigned: boolean; pipelineIds: string[]; connectionIds: string[]; input: TeamAccessInput };

/** IDs vindos da tela são validados na organização antes de gravar. */
async function validateAccess(organizationId: string, input: TeamAccessInput): Promise<CheckedAccess | { error: string }> {
  const role = input.role === "ADMIN" ? "ADMIN" : "MEMBER";
  const permissions = [...new Set(input.permissions ?? [])].filter((permission) => (MODULE_PERMISSIONS as readonly string[]).includes(permission));
  const pipelineIds = [...new Set((input.pipelineAccesses ?? []).map((access) => access.pipelineId).filter(Boolean))];
  const connectionIds = [...new Set((input.connectionAccesses ?? []).map((access) => access.connectionId).filter(Boolean))];
  const [pipelineCount, connectionCount] = await Promise.all([
    prisma.pipeline.count({ where: { organizationId, id: { in: pipelineIds } } }),
    prisma.connection.count({ where: { organizationId, id: { in: connectionIds } } }),
  ]);
  if (pipelineCount !== pipelineIds.length || connectionCount !== connectionIds.length) return { error: "Há um pipeline ou instância inválida na seleção." };
  const dataScope = role === "ADMIN" ? "all" : isDataScope(input.dataScope) ? input.dataScope : "own";
  return { role, permissions, dataScope, seeUnassigned: input.seeUnassigned !== false, pipelineIds, connectionIds, input };
}

async function applyAccess(tx: TxClient, userId: string, access: CheckedAccess) {
  await tx.user.update({
    where: { id: userId },
    data: { role: access.role, permissions: JSON.stringify(access.permissions), accessConfigured: access.role !== "ADMIN", dataScope: access.dataScope, seeUnassigned: access.seeUnassigned },
  });
  await tx.userPipelineAccess.deleteMany({ where: { userId } });
  await tx.userConnectionAccess.deleteMany({ where: { userId } });
  if (access.role === "MEMBER") {
    if (access.pipelineIds.length) await tx.userPipelineAccess.createMany({ data: access.pipelineIds.map((pipelineId) => ({ userId, pipelineId, canView: true, canEdit: access.input.pipelineAccesses.find((item) => item.pipelineId === pipelineId)?.canEdit ?? false })) });
    if (access.connectionIds.length) await tx.userConnectionAccess.createMany({ data: access.connectionIds.map((connectionId) => ({ userId, connectionId, canView: true, canSend: access.input.connectionAccesses.find((item) => item.connectionId === connectionId)?.canSend ?? false })) });
  }
}

/** Salva a matriz de acesso de um membro. IDs vindos da tela são validados na
 * organização antes da gravação; a lista vazia é deliberadamente restritiva. */
export async function updateTeamMemberAccess(id: string, input: TeamAccessInput) {
  const current = await requireAdminUser();
  if (current.id === id) return { error: "Para evitar perda de acesso, outro administrador deve alterar suas permissões." };
  const target = await prisma.user.findFirst({ where: { id, organizationId: current.organizationId }, select: { id: true } });
  if (!target) return { error: "Membro não encontrado." };

  const checked = await validateAccess(current.organizationId, input);
  if ("error" in checked) return { error: checked.error };
  await prisma.$transaction((tx) => applyAccess(tx, id, checked));
  await audit(current.organizationId, { action: "team.access_updated", entity: "User", entityId: id, ...actorOf(current), meta: { role: checked.role, dataScope: checked.dataScope, seeUnassigned: checked.seeUnassigned, permissions: checked.permissions, pipelines: checked.pipelineIds, connections: checked.connectionIds } });
  revalidatePath("/team");
  revalidatePath("/pipeline");
  revalidatePath("/conversations");
  return { ok: true };
}

// Membro inativo (ex: de férias) sai do rodízio de atribuição automática
// (ver assignNextOwner em lib/assignment.ts) sem precisar excluir a conta.
export async function toggleTeamMemberActive(id: string, isActive: boolean) {
  const current = await requireAdminUser();
  const { organizationId } = current;
  if (current.id === id && !isActive) throw new Error("Outro administrador deve desativar seu acesso.");
  await prisma.user.updateMany({ where: { id, organizationId }, data: { isActive, ...(!isActive ? { sessionVersion: { increment: 1 } } : {}) } });
  await audit(organizationId, { action: isActive ? "team.activated" : "team.deactivated", entity: "User", entityId: id, ...actorOf(current) });
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
