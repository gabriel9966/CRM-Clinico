"use server";

import { revalidatePath } from "next/cache";
import { requireOrgUser } from "@/lib/auth";
import { actorOf } from "@/lib/audit";
import { AppError } from "@/lib/errors";
import { purge, purgeOlderThan, restore, type TrashEntity } from "@/lib/trash";

// Restaurar e apagar de vez são decisões de administrador. A checagem é aqui no
// servidor: uma server action pode ser chamada direto, então esconder o botão
// na tela não basta.
async function requireAdmin() {
  const user = await requireOrgUser();
  if (user.role !== "ADMIN") throw new AppError("sem_permissao", "apenas administradores", 403);
  return user;
}

export type TrashResult = { ok: true } | { ok: false; error: string };

function failure(err: unknown): TrashResult {
  if (err instanceof AppError) return { ok: false, error: err.message };
  throw err;
}

function revalidate() {
  for (const p of ["/trash", "/contacts", "/pipeline", "/appointments", "/conversations"]) revalidatePath(p);
}

export async function restoreItem(entity: TrashEntity, id: string): Promise<TrashResult> {
  const user = await requireAdmin();
  try {
    await restore(user.organizationId, entity, id, actorOf(user));
    revalidate();
    return { ok: true };
  } catch (err) {
    return failure(err);
  }
}

export async function purgeItem(entity: TrashEntity, id: string): Promise<TrashResult> {
  const user = await requireAdmin();
  try {
    await purge(user.organizationId, entity, id, actorOf(user));
    revalidate();
    return { ok: true };
  } catch (err) {
    return failure(err);
  }
}

export async function emptyTrash(olderThanDays: number): Promise<{ ok: true; removed: number } | { ok: false; error: string }> {
  const user = await requireAdmin();
  const days = Math.min(Math.max(Math.trunc(olderThanDays) || 30, 1), 3650);
  const res = await purgeOlderThan(user.organizationId, days, actorOf(user));
  revalidate();
  return { ok: true, removed: res.contacts + res.opportunities + res.appointments };
}
