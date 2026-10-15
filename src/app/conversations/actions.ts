"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireOrgUser } from "@/lib/auth";
import { getSendOptions, sendContactMessage, type SendErrorCode } from "@/lib/messaging";
import type { SendOptionDTO } from "@/lib/types";

export type SendOutcome =
  | { ok: true; status: "sent" | "failed"; error?: string }
  | { ok: false; code: SendErrorCode | "sem_permissao"; error: string };

// MEMBER só pode falar com contatos atribuídos a ele(a) — mesma regra de
// visibilidade da tela de Conversas, aplicada aqui pra não dar pra burlar só
// adivinhando o id de um contato de outro atendente.
async function canTalkTo(user: { id: string; role: string; organizationId: string }, contactId: string) {
  const contact = await prisma.contact.findFirst({
    where: { id: contactId, organizationId: user.organizationId },
    select: { ownerId: true },
  });
  if (!contact) return false;
  return user.role === "ADMIN" || contact.ownerId === user.id;
}

/** Canais pelos quais o usuário pode falar com este contato (para a tela escolher). */
export async function fetchSendOptions(contactId: string): Promise<SendOptionDTO[]> {
  const user = await requireOrgUser();
  if (!(await canTalkTo(user, contactId))) return [];
  return getSendOptions(user.organizationId, contactId);
}

/**
 * Envia uma mensagem por um canal real. Sem canal, desconectado ou sem
 * permissão: não grava nada e devolve o motivo (a tela mostra ao atendente).
 */
export async function sendMessage(contactId: string, text: string, connectionId?: string): Promise<SendOutcome> {
  const user = await requireOrgUser();
  if (!(await canTalkTo(user, contactId))) {
    return { ok: false, code: "sem_permissao", error: "Você não pode enviar mensagem para este contato." };
  }
  const result = await sendContactMessage(user.organizationId, contactId, text, { connectionId, senderId: user.id });
  revalidatePath("/conversations");
  if (!result.ok) return { ok: false, code: result.code, error: result.error };
  return { ok: true, status: result.status, ...(result.error ? { error: result.error } : {}) };
}
