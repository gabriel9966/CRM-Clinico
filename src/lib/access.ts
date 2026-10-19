import "server-only";

import { prisma } from "@/lib/prisma";
import { MODULE_PERMISSIONS, type ModulePermission } from "@/lib/access-policy";
import { AppError } from "@/lib/errors";
import { isDataScope, ownerInScope, type OwnerScope } from "@/lib/access-scope";
export { scopeWhere, ownerInScope, type OwnerScope } from "@/lib/access-scope";
export { MODULE_PERMISSIONS, type ModulePermission } from "@/lib/access-policy";

/** Permissões de módulo guardadas no usuário. A gestão de escopo (pipeline e
 * instância) é feita pelas tabelas próprias, para ser segura e consultável. */
export type AccessUser = {
  id: string;
  organizationId: string;
  role: string;
  accessConfigured: boolean;
  permissions?: string;
};

export function userPermissions(user: Pick<AccessUser, "role" | "permissions">): string[] {
  if (user.role === "ADMIN") return [...MODULE_PERMISSIONS];
  try {
    const parsed = JSON.parse(user.permissions ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

export function hasModulePermission(user: Pick<AccessUser, "role" | "permissions" | "accessConfigured">, permission: ModulePermission) {
  return user.role === "ADMIN" || userPermissions(user).includes(permission);
}

/** Enquanto um administrador ainda não configurou o escopo, preservamos o
 * comportamento da conta legada. Ao salvar os acessos, a lista vira restritiva
 * — inclusive uma lista vazia significa nenhum pipeline/instância. */
export async function allowedPipelineIds(user: AccessUser): Promise<string[] | null> {
  if (user.role === "ADMIN") return null;
  const rows = await prisma.userPipelineAccess.findMany({ where: { userId: user.id, canView: true }, select: { pipelineId: true } });
  return rows.map((row) => row.pipelineId);
}

export async function allowedConnectionIds(user: AccessUser, mode: "view" | "send" = "view"): Promise<string[] | null> {
  if (user.role === "ADMIN") return null;
  const rows = await prisma.userConnectionAccess.findMany({
    where: { userId: user.id, ...(mode === "send" ? { canSend: true } : { canView: true }) },
    select: { connectionId: true },
  });
  return rows.map((row) => row.connectionId);
}

/**
 * Carteira visível ao usuário (contatos, negócios, conversas). null = todos.
 * ADMIN e escopo "all" veem tudo; "team" = responsáveis da mesma equipe;
 * "own" = só ele. seeUnassigned inclui os registros sem responsável (fila).
 */
export async function getOwnerScope(user: AccessUser & { dataScope?: string | null; seeUnassigned?: boolean | null; team?: string | null }): Promise<OwnerScope> {
  if (user.role === "ADMIN") return null;
  const scope = isDataScope(user.dataScope) ? user.dataScope : "own";
  if (scope === "all") return null;
  const includeUnassigned = user.seeUnassigned !== false;
  if (scope === "team") {
    const mates = await prisma.user.findMany({ where: { organizationId: user.organizationId, team: user.team ?? "Geral" }, select: { id: true } });
    const ids = mates.map((m) => m.id);
    return { ids: ids.includes(user.id) ? ids : [...ids, user.id], includeUnassigned };
  }
  return { ids: [user.id], includeUnassigned };
}

/** Lança AppError 403 se o registro (pelo responsável) estiver fora da carteira do usuário. */
export async function assertOwnerInScope(user: Parameters<typeof getOwnerScope>[0], ownerId: string | null | undefined) {
  if (!ownerInScope(await getOwnerScope(user), ownerId)) {
    throw new AppError("fora_da_carteira", "Este registro pertence à carteira de outra pessoa.", 403);
  }
}

export async function canAccessPipeline(user: AccessUser, pipelineId: string, mode: "view" | "edit" = "view") {
  if (user.role === "ADMIN") return true;
  const row = await prisma.userPipelineAccess.findFirst({ where: { userId: user.id, pipelineId }, select: { canView: true, canEdit: true } });
  return Boolean(row && (mode === "edit" ? row.canEdit : row.canView));
}

export async function canAccessConnection(user: AccessUser, connectionId: string, mode: "view" | "send" = "view") {
  if (user.role === "ADMIN") return true;
  const row = await prisma.userConnectionAccess.findFirst({ where: { userId: user.id, connectionId }, select: { canView: true, canSend: true } });
  return Boolean(row && (mode === "send" ? row.canSend : row.canView));
}
