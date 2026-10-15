"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireOrgUser } from "@/lib/auth";

export type CustomFieldInput = {
  entity: "CONTACT" | "OPPORTUNITY";
  label: string;
  type: "TEXT" | "NUMBER" | "DATE" | "BOOLEAN" | "SELECT";
  options: string[];
};

function slugifyKey(label: string) {
  return label
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
}

export async function createCustomField(data: CustomFieldInput) {
  const { organizationId } = await requireOrgUser();
  const label = data.label.trim();
  if (!label) return { error: "Nome do campo é obrigatório." };
  const key = slugifyKey(label);
  if (!key) return { error: "Nome do campo inválido." };

  const existing = await prisma.customFieldDefinition.findUnique({
    where: { organizationId_entity_key: { organizationId, entity: data.entity, key } },
  });
  if (existing) return { error: "Já existe um campo com esse nome." };

  const last = await prisma.customFieldDefinition.findFirst({
    where: { organizationId, entity: data.entity },
    orderBy: { order: "desc" },
  });

  await prisma.customFieldDefinition.create({
    data: {
      organizationId,
      entity: data.entity,
      key,
      label,
      type: data.type,
      options: JSON.stringify(data.type === "SELECT" ? data.options.filter(Boolean) : []),
      order: (last?.order ?? -1) + 1,
    },
  });
  revalidatePath("/custom-fields");
  revalidatePath("/contacts");
  revalidatePath("/pipeline");
  return {};
}

export async function deleteCustomField(id: string) {
  const { organizationId } = await requireOrgUser();
  await prisma.customFieldDefinition.deleteMany({ where: { id, organizationId } });
  revalidatePath("/custom-fields");
  revalidatePath("/contacts");
  revalidatePath("/pipeline");
}
