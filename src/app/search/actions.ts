"use server";

import { requireOrgUser } from "@/lib/auth";
import { globalSearch as runGlobalSearch, type GlobalSearchResult } from "@/lib/search";

export async function globalSearchAction(query: string): Promise<GlobalSearchResult> {
  const { organizationId } = await requireOrgUser();
  return runGlobalSearch(organizationId, query);
}
