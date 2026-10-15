import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma";

// Trilha de auditoria: quem fez o quê e quando. Dados de pacientes/clientes
// exigem rastreabilidade (LGPD), então toda exclusão, restauração e mudança
// sensível grava uma linha aqui. A tela /audit lista (só ADMIN).

export type AuditEntry = {
  action: string; // ex.: "contact.deleted"
  entity: string; // ex.: "Contact"
  entityId?: string | null;
  actorId?: string | null;
  actorName?: string | null;
  ip?: string | null;
  meta?: Record<string, unknown>;
};

/** Qualquer cliente Prisma (normal, de transação ou sem filtro de lixeira) que saiba criar AuditLog. */
export type AuditDb = {
  auditLog: { create(args: { data: Prisma.AuditLogUncheckedCreateInput }): PromiseLike<unknown> };
};

/** Grava dentro de uma transação (ou fora). Falha aqui propaga o erro. */
export async function writeAudit(db: AuditDb, organizationId: string, entry: AuditEntry) {
  await db.auditLog.create({
    data: {
      organizationId,
      action: entry.action,
      entity: entry.entity,
      entityId: entry.entityId ?? null,
      actorId: entry.actorId ?? null,
      actorName: entry.actorName ?? null,
      ip: entry.ip ?? null,
      meta: (entry.meta ?? {}) as Prisma.InputJsonValue,
    },
  });
}

/** Versão "melhor esforço": nunca derruba a operação principal. */
export async function audit(organizationId: string, entry: AuditEntry) {
  try {
    await writeAudit(prisma, organizationId, entry);
  } catch (err) {
    console.error("[audit] falha ao gravar log:", err);
  }
}

export function actorOf(user: { id: string; name: string }) {
  return { actorId: user.id, actorName: user.name };
}

export type AuditLogDTO = {
  id: string;
  action: string;
  entity: string;
  entityId: string | null;
  actorName: string | null;
  ip: string | null;
  meta: Record<string, unknown>;
  createdAt: string;
};

export type AuditQuery = { cursor?: string; limit?: number; entity?: string; action?: string; q?: string };

const MAX_PAGE = 100;

/** Página de logs, do mais novo para o mais antigo, com paginação por cursor. */
export async function listAuditLogs(organizationId: string, query: AuditQuery = {}) {
  const limit = Math.min(Math.max(query.limit ?? 50, 1), MAX_PAGE);
  const rows = await prisma.auditLog.findMany({
    where: {
      organizationId,
      ...(query.entity ? { entity: query.entity } : {}),
      ...(query.action ? { action: { startsWith: query.action } } : {}),
      ...(query.q
        ? {
            OR: [
              { actorName: { contains: query.q, mode: "insensitive" } },
              { entityId: { contains: query.q } },
              { action: { contains: query.q, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
  });

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const items: AuditLogDTO[] = page.map((r) => ({
    id: r.id,
    action: r.action,
    entity: r.entity,
    entityId: r.entityId,
    actorName: r.actorName,
    ip: r.ip,
    meta: (r.meta as Record<string, unknown>) ?? {},
    createdAt: r.createdAt.toISOString(),
  }));
  return { items, nextCursor: hasMore ? page[page.length - 1].id : null };
}
