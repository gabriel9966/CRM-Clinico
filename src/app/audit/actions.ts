"use server";

import { requireOrgUser } from "@/lib/auth";
import { listAuditLogs, type AuditQuery } from "@/lib/audit";
import { AppError } from "@/lib/errors";

// O log de auditoria só é visível a administradores.
export async function fetchAuditLogs(query: Pick<AuditQuery, "cursor" | "entity" | "action" | "q">) {
  const user = await requireOrgUser();
  if (user.role !== "ADMIN") throw new AppError("sem_permissao", "apenas administradores", 403);
  return listAuditLogs(user.organizationId, {
    cursor: query.cursor,
    entity: query.entity?.slice(0, 40) || undefined,
    action: query.action?.slice(0, 60) || undefined,
    q: query.q?.slice(0, 80) || undefined,
    limit: 50,
  });
}
