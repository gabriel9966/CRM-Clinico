import "server-only";
import { prisma } from "./prisma";

// Round-robin simples: pega os membros ativos da org ordenados por id,
// acha quem vem depois do último atribuído (Organization.lastAssignedUserId)
// e avança o ponteiro. Usado pra atribuir automaticamente contatos novos que
// chegam via webhook (WhatsApp/Instagram/E-mail) sem responsável definido.
export async function assignNextOwner(organizationId: string): Promise<string | null> {
  const [org, members] = await Promise.all([
    prisma.organization.findUnique({ where: { id: organizationId }, select: { lastAssignedUserId: true } }),
    prisma.user.findMany({
      where: { organizationId, isActive: true },
      select: { id: true },
      orderBy: { id: "asc" },
    }),
  ]);
  if (members.length === 0) return null;

  const lastIdx = org?.lastAssignedUserId ? members.findIndex((m) => m.id === org.lastAssignedUserId) : -1;
  const next = members[(lastIdx + 1) % members.length];

  await prisma.organization.update({ where: { id: organizationId }, data: { lastAssignedUserId: next.id } });
  return next.id;
}
