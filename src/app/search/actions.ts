"use server";

import { requireOrgUser } from "@/lib/auth";
import { allowedPipelineIds, getOwnerScope, hasModulePermission } from "@/lib/access";
import { globalSearch as runGlobalSearch, type GlobalSearchResult } from "@/lib/search";

export async function globalSearchAction(query: string): Promise<GlobalSearchResult> {
  const user = await requireOrgUser();
  return runGlobalSearch(user.organizationId, query.slice(0, 100), {
    contacts: hasModulePermission(user, "contacts.read"),
    pipelineIds: hasModulePermission(user, "pipeline.read") ? await allowedPipelineIds(user) : [],
    owners: await getOwnerScope(user),
  });
}
