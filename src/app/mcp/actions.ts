"use server";

import { revalidatePath } from "next/cache";
import { requireAdminUser } from "@/lib/auth";
import { regenerateMcpApiKey } from "@/lib/mcp-config";

export async function regenerateKey() {
  const { organizationId } = await requireAdminUser();
  const key = await regenerateMcpApiKey(organizationId);
  revalidatePath("/mcp");
  return key;
}
