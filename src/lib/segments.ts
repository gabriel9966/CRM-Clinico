import "server-only";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma";

// Critérios de uma lista salva (smart list). Guardados como JSON string em
// Segment.filters. "tag"/"owner"/"createdAfter"/"createdBefore" cobrem Contact
// e Opportunity (ambos têm esses campos); "customField" vale pros campos extras
// configurados em CustomFieldDefinition.
const conditionSchema = z.discriminatedUnion("field", [
  z.object({ field: z.literal("tag"), value: z.string().min(1) }),
  z.object({ field: z.literal("owner"), value: z.string().nullable() }),
  z.object({ field: z.literal("customField"), key: z.string().min(1), value: z.string() }),
  z.object({ field: z.literal("createdAfter"), value: z.string() }),
  z.object({ field: z.literal("createdBefore"), value: z.string() }),
]);

export const segmentFiltersSchema = z.object({ conditions: z.array(conditionSchema).default([]) });
export type SegmentCondition = z.infer<typeof conditionSchema>;
export type SegmentFilters = z.infer<typeof segmentFiltersSchema>;

export function parseSegmentFilters(raw: string): SegmentFilters {
  try {
    return segmentFiltersSchema.parse(JSON.parse(raw));
  } catch {
    return { conditions: [] };
  }
}

// Traduz os critérios em cláusulas de banco (todas combinadas com AND). Antes a
// lista era avaliada em memória sobre TODOS os contatos; agora o banco filtra
// e as telas paginam o resultado.
function clauseFor(condition: SegmentCondition): Record<string, unknown> {
  switch (condition.field) {
    case "tag":
      // "VIP" com aspas: não casa com "VIP2"
      return { tags: { contains: JSON.stringify(condition.value) } };
    case "owner":
      return { ownerId: condition.value };
    case "customField": {
      // O valor guardado pode ser texto, número ou booleano; o critério vem como texto.
      const equals: (string | number | boolean)[] = [condition.value];
      if (condition.value.trim() !== "" && !Number.isNaN(Number(condition.value))) equals.push(Number(condition.value));
      if (condition.value === "true" || condition.value === "false") equals.push(condition.value === "true");
      return { OR: equals.map((v) => ({ customFields: { path: [condition.key], equals: v } })) };
    }
    case "createdAfter":
      return { createdAt: { gte: new Date(condition.value) } };
    case "createdBefore":
      return { createdAt: { lte: new Date(condition.value) } };
  }
}

/** `where` (sem organizationId) para a lista salva; serve para Contact e Opportunity. */
export function segmentWhere(filtersRaw: string): { AND: Record<string, unknown>[] } {
  const { conditions } = parseSegmentFilters(filtersRaw);
  return { AND: conditions.map(clauseFor) };
}

export async function evaluateSegment(
  organizationId: string,
  entity: "CONTACT" | "OPPORTUNITY",
  filtersRaw: string
): Promise<{ id: string }[]> {
  const where = { organizationId, ...segmentWhere(filtersRaw) };
  if (entity === "CONTACT") {
    return prisma.contact.findMany({ where: where as Prisma.ContactWhereInput, select: { id: true } });
  }
  return prisma.opportunity.findMany({ where: where as Prisma.OpportunityWhereInput, select: { id: true } });
}
