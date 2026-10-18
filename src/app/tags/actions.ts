"use server";

import { revalidatePath } from "next/cache";
import { requireAdminUser } from "@/lib/auth";
import { actorOf } from "@/lib/audit";
import { createTag, deleteTag, updateTag } from "@/lib/crm-catalog";

export type TagInput = { name: string; color: string; description: string; appliesToContacts: boolean; appliesToOpportunities: boolean };

function refreshTagViews() {
  revalidatePath("/tags");
  revalidatePath("/contacts");
  revalidatePath("/pipeline");
  revalidatePath("/conversations");
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Não foi possível salvar a tag.";
}

export async function createTagAction(input: TagInput) {
  const user = await requireAdminUser();
  try {
    await createTag(user.organizationId, input, actorOf(user));
    refreshTagViews();
    return {};
  } catch (error) {
    return { error: errorMessage(error) };
  }
}

export async function updateTagAction(id: string, input: TagInput) {
  const user = await requireAdminUser();
  try {
    await updateTag(user.organizationId, id, input, actorOf(user));
    refreshTagViews();
    return {};
  } catch (error) {
    return { error: errorMessage(error) };
  }
}

export async function deleteTagAction(id: string) {
  const user = await requireAdminUser();
  try {
    await deleteTag(user.organizationId, id, actorOf(user));
    refreshTagViews();
    return {};
  } catch (error) {
    return { error: errorMessage(error) };
  }
}
