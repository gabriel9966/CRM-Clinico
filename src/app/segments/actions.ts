"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireOrgUser } from "@/lib/auth";
import { segmentFiltersSchema, evaluateSegment, type SegmentCondition } from "@/lib/segments";

export async function createSegment(name: string, entity: "CONTACT" | "OPPORTUNITY", conditions: SegmentCondition[]) {
  const { organizationId } = await requireOrgUser();
  const trimmed = name.trim();
  if (!trimmed) return;
  const filters = segmentFiltersSchema.parse({ conditions });

  await prisma.segment.create({
    data: { organizationId, name: trimmed, entity, filters: JSON.stringify(filters) },
  });
  revalidatePath("/contacts");
}

export async function deleteSegment(id: string) {
  const { organizationId } = await requireOrgUser();
  await prisma.segment.deleteMany({ where: { id, organizationId } });
  revalidatePath("/contacts");
}

// Reavalia uma lista salva e devolve os ids que batem. A tela de contatos não
// usa mais isto (filtra paginado pelo servidor via segmentId); fica para
// quem precisar do conjunto completo.
export async function applySegment(id: string): Promise<string[]> {
  const { organizationId } = await requireOrgUser();
  const segment = await prisma.segment.findFirst({ where: { id, organizationId } });
  if (!segment) return [];
  const matches = await evaluateSegment(organizationId, segment.entity, segment.filters);
  return matches.map((m) => m.id);
}
