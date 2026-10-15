"use server";

import { requireOrgUser } from "@/lib/auth";
import { searchContacts, searchOpportunities } from "@/lib/queries";

// Busca por digitação dos seletores (contato / negócio) — no lugar de carregar
// a lista inteira em um <select>.

export type PickerOption = { id: string; label: string; hint?: string };

export async function searchContactOptions(q: string): Promise<PickerOption[]> {
  const { organizationId } = await requireOrgUser();
  const rows = await searchContacts(organizationId, q.slice(0, 80), 15);
  return rows.map((c) => ({ id: c.id, label: c.name, hint: c.phone ?? c.email ?? c.company ?? undefined }));
}

export async function searchOpportunityOptions(q: string): Promise<PickerOption[]> {
  const { organizationId } = await requireOrgUser();
  const rows = await searchOpportunities(organizationId, q.slice(0, 80), 15);
  return rows.map((o) => ({ id: o.id, label: o.title, hint: o.contactName ?? undefined }));
}
