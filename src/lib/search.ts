import "server-only";
import { prisma } from "./prisma";
import type { ContactDTO, OpportunityDTO } from "./types";

function parseTags(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export type GlobalSearchResult = {
  contacts: ContactDTO[];
  opportunities: (OpportunityDTO & { contactName: string })[];
};

// Busca server-side por contatos (nome/empresa/e-mail/telefone/tags) e
// oportunidades (título, pelo nome do contato vinculado), limitada a 8
// resultados por entidade — alimenta a barra de busca global.
export async function globalSearch(organizationId: string, query: string): Promise<GlobalSearchResult> {
  const q = query.trim();
  if (!q) return { contacts: [], opportunities: [] };

  const contacts = await prisma.contact.findMany({
    where: {
      organizationId,
      OR: [
        { name: { contains: q, mode: "insensitive" } },
        { company: { contains: q, mode: "insensitive" } },
        { email: { contains: q, mode: "insensitive" } },
        { phone: { contains: q } },
        { tags: { contains: q, mode: "insensitive" } },
      ],
    },
    orderBy: { createdAt: "desc" },
    take: 8,
  });

  const opportunities = await prisma.opportunity.findMany({
    where: {
      organizationId,
      OR: [
        { title: { contains: q, mode: "insensitive" } },
        { contact: { name: { contains: q, mode: "insensitive" } } },
      ],
    },
    include: { contact: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
    take: 8,
  });

  return {
    contacts: contacts.map((c) => ({
      id: c.id,
      name: c.name,
      company: c.company,
      email: c.email,
      phone: c.phone,
      tags: parseTags(c.tags),
      notes: c.notes,
      ownerId: c.ownerId,
      customFields: (c.customFields as Record<string, unknown>) ?? {},
      createdAt: c.createdAt.toISOString(),
    })),
    opportunities: opportunities.map((o) => ({
      id: o.id,
      title: o.title,
      value: o.value,
      tags: parseTags(o.tags),
      contactId: o.contactId,
      contactName: o.contact.name,
      pipelineId: o.pipelineId,
      stageId: o.stageId,
      ownerId: o.ownerId,
      expectedClose: o.expectedClose ? o.expectedClose.toISOString() : null,
      lossReason: o.lossReason,
      customFields: (o.customFields as Record<string, unknown>) ?? {},
      createdAt: o.createdAt.toISOString(),
    })),
  };
}
