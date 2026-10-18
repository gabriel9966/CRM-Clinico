"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireOrgUser } from "@/lib/auth";
import { canAccessConnection, hasModulePermission } from "@/lib/access";
import { getSendOptions, sendContactMessage, type SendErrorCode } from "@/lib/messaging";
import type { SendOptionDTO } from "@/lib/types";
import { actorOf, audit } from "@/lib/audit";
import type { ConversationEventDTO } from "@/lib/types";
import { syncTags } from "@/lib/crm-catalog";

export type SendOutcome =
  | { ok: true; status: "sent" | "failed"; error?: string }
  | { ok: false; code: SendErrorCode | "sem_permissao"; error: string };

async function canTalkTo(user: { id: string; role: string; organizationId: string; accessConfigured: boolean }, contactId: string) {
  if (!hasModulePermission(user, "conversations.reply")) return false;
  const contact = await prisma.contact.findFirst({ where: { id: contactId, organizationId: user.organizationId }, select: { ownerId: true } });
  return Boolean(contact && (user.role === "ADMIN" || contact.ownerId === user.id));
}

/** Used when starting a new conversation from a contact screen. */
export async function fetchSendOptions(contactId: string): Promise<SendOptionDTO[]> {
  const user = await requireOrgUser();
  if (!(await canTalkTo(user, contactId))) return [];
  return getSendOptions(user.organizationId, contactId);
}

async function getConversationForUser(user: { id: string; role: string; organizationId: string; accessConfigured: boolean }, conversationId: string) {
  if (!hasModulePermission(user, "conversations.read")) return null;
  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId, organizationId: user.organizationId },
    select: { id: true, contactId: true, connectionId: true, ownerId: true, status: true },
  });
  if (!conversation || (user.role !== "ADMIN" && conversation.ownerId !== user.id && !hasModulePermission(user, "conversations.manage"))) return null;
  if (conversation.connectionId && !(await canAccessConnection(user, conversation.connectionId))) return null;
  return conversation;
}

/** An open thread sends only through its own connection/instance. */
export async function fetchConversationSendOptions(conversationId: string): Promise<SendOptionDTO[]> {
  const user = await requireOrgUser();
  const conversation = await getConversationForUser(user, conversationId);
  if (!conversation?.connectionId) return [];
  return (await getSendOptions(user.organizationId, conversation.contactId)).filter((option) => option.connectionId === conversation.connectionId);
}

export type PrivateNoteDTO = { id: string; text: string; createdAt: string };

export async function fetchPrivateNotes(conversationId: string): Promise<PrivateNoteDTO[]> {
  const user = await requireOrgUser();
  if (!(await getConversationForUser(user, conversationId))) return [];
  const notes = await prisma.conversationPrivateNote.findMany({
    where: { organizationId: user.organizationId, conversationId, authorId: user.id },
    orderBy: { createdAt: "desc" }, take: 100,
    select: { id: true, text: true, createdAt: true },
  });
  return notes.reverse().map((note) => ({ ...note, createdAt: note.createdAt.toISOString() }));
}

export async function addPrivateNote(conversationId: string, rawText: string) {
  const user = await requireOrgUser();
  if (!(await getConversationForUser(user, conversationId))) return { ok: false as const, error: "Atendimento não disponível." };
  const text = rawText.trim();
  if (!text || text.length > 4000) return { ok: false as const, error: "Escreva uma nota de até 4.000 caracteres." };
  const note = await prisma.conversationPrivateNote.create({ data: { organizationId: user.organizationId, conversationId, authorId: user.id, text } });
  return { ok: true as const, note: { id: note.id, text: note.text, createdAt: note.createdAt.toISOString() } };
}

export async function sendMessage(conversationId: string, text: string): Promise<SendOutcome> {
  const user = await requireOrgUser();
  if (!hasModulePermission(user, "conversations.reply")) return { ok: false, code: "sem_permissao", error: "Você não tem permissão para responder atendimentos." };
  const conversation = await getConversationForUser(user, conversationId);
  if (!conversation) return { ok: false, code: "sem_permissao", error: "Você não pode enviar mensagem neste atendimento." };
  if (conversation.status === "CLOSED") return { ok: false, code: "sem_permissao", error: "Reabra o atendimento antes de enviar uma mensagem." };
  if (!conversation.connectionId) return { ok: false, code: "sem_canal", error: "Este histórico não tem canal identificado e não pode receber novos envios." };

  if (!(await canAccessConnection(user, conversation.connectionId, "send"))) return { ok: false, code: "sem_permissao", error: "Você não tem permissão para enviar por esta instância." };
  const result = await sendContactMessage(user.organizationId, conversation.contactId, text, {
    connectionId: conversation.connectionId,
    senderId: user.id,
    conversationId: conversation.id,
  });
  revalidatePath("/conversations");
  if (!result.ok) return { ok: false, code: result.code, error: result.error };
  return { ok: true, status: result.status, ...(result.error ? { error: result.error } : {}) };
}

/** Reenvia uma saída que falhou pela mesma instância da conversa. A tentativa
 * anterior é mantida no histórico; o reenvio sempre vira uma nova tentativa. */
export async function retryFailedMessage(conversationId: string, messageId: string): Promise<SendOutcome> {
  const user = await requireOrgUser();
  const conversation = await getConversationForUser(user, conversationId);
  if (!conversation || !conversation.connectionId) return { ok: false, code: "sem_permissao", error: "Atendimento ou canal não disponível para reenvio." };
  const message = await prisma.message.findFirst({
    where: { id: messageId, organizationId: user.organizationId, conversationId, direction: "out", status: "failed" },
    select: { text: true },
  });
  if (!message) return { ok: false, code: "sem_permissao", error: "Esta mensagem não está disponível para reenvio." };
  const result = await sendContactMessage(user.organizationId, conversation.contactId, message.text, { connectionId: conversation.connectionId, senderId: user.id, conversationId });
  await audit(user.organizationId, { action: "message.retry", entity: "Conversation", entityId: conversationId, ...actorOf(user), meta: { messageId, result: result.ok ? result.status : result.code } });
  revalidatePath("/conversations");
  if (!result.ok) return { ok: false, code: result.code, error: result.error };
  return { ok: true, status: result.status, ...(result.error ? { error: result.error } : {}) };
}

export async function assignConversation(conversationId: string, ownerId: string | null, mode: "assign" | "transfer" | "claim" = "assign") {
  const user = await requireOrgUser();
  if (!hasModulePermission(user, "conversations.manage") && mode !== "claim") return { ok: false, error: "Você não tem permissão para gerir atendimentos." };
  const conversation = await prisma.conversation.findFirst({ where: { id: conversationId, organizationId: user.organizationId }, select: { ownerId: true } });
  if (!conversation) return { ok: false, error: "Atendimento não encontrado." };
  if (mode === "claim") ownerId = user.id;
  if (user.role !== "ADMIN" && ownerId !== user.id) return { ok: false, error: "Somente administradores podem transferir atendimentos." };
  if (ownerId && !(await prisma.user.findFirst({ where: { id: ownerId, organizationId: user.organizationId, isActive: true }, select: { id: true } }))) {
    return { ok: false, error: "Atendente inválido ou inativo." };
  }
  await prisma.conversation.update({ where: { id: conversationId }, data: { ownerId } });
  const action = mode === "claim" ? "conversation.claimed" : conversation.ownerId && ownerId !== conversation.ownerId ? "conversation.transferred" : "conversation.assigned";
  await audit(user.organizationId, { action, entity: "Conversation", entityId: conversationId, ...actorOf(user), meta: { previousOwnerId: conversation.ownerId, ownerId } });
  revalidatePath("/conversations");
  return { ok: true };
}

export async function setConversationStatus(conversationId: string, status: "OPEN" | "CLOSED") {
  const user = await requireOrgUser();
  const conversation = await getConversationForUser(user, conversationId);
  if (!conversation) return { ok: false, error: "Atendimento não encontrado." };
  await prisma.conversation.update({ where: { id: conversationId }, data: { status, closedAt: status === "CLOSED" ? new Date() : null } });
  await audit(user.organizationId, { action: status === "CLOSED" ? "conversation.closed" : "conversation.reopened", entity: "Conversation", entityId: conversationId, ...actorOf(user) });
  revalidatePath("/conversations");
  return { ok: true };
}

export async function fetchConversationEvents(conversationId: string): Promise<ConversationEventDTO[]> {
  const user = await requireOrgUser();
  const conversation = await getConversationForUser(user, conversationId);
  if (!conversation) return [];
  const items = await prisma.auditLog.findMany({
    where: { organizationId: user.organizationId, entity: "Conversation", entityId: conversationId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 100,
  });
  const titles: Record<string, string> = {
    "conversation.assigned": "Atendimento atribuído",
    "conversation.transferred": "Atendimento transferido",
    "conversation.claimed": "Atendimento assumido",
    "conversation.closed": "Atendimento finalizado",
    "conversation.reopened": "Atendimento reaberto",
    "conversation.tag_added": "Tag adicionada",
    "conversation.tag_removed": "Tag removida",
  };
  return items.filter((item) => titles[item.action]).map((item) => ({
    id: item.id,
    action: item.action.replace("conversation.", "") as ConversationEventDTO["action"],
    actorName: item.actorName,
    detail: titles[item.action],
    createdAt: item.createdAt.toISOString(),
  }));
}

export async function updateConversationTags(conversationId: string, tags: string[]) {
  const user = await requireOrgUser();
  const conversation = await getConversationForUser(user, conversationId);
  if (!conversation) return { ok: false, error: "Atendimento não encontrado." };
  const contact = await prisma.contact.findFirst({ where: { id: conversation.contactId, organizationId: user.organizationId }, select: { tags: true } });
  if (!contact) return { ok: false, error: "Contato não encontrado." };
  let previous: string[] = [];
  try { previous = JSON.parse(contact.tags) as string[]; } catch { previous = []; }
  const next = [...new Set(tags.map((tag) => tag.trim()).filter(Boolean))];
  await prisma.contact.update({ where: { id: conversation.contactId }, data: { tags: JSON.stringify(next) } });
  await syncTags(user.organizationId, next);
  for (const tag of next.filter((tag) => !previous.includes(tag))) {
    await audit(user.organizationId, { action: "conversation.tag_added", entity: "Conversation", entityId: conversationId, ...actorOf(user), meta: { tag } });
  }
  for (const tag of previous.filter((tag) => !next.includes(tag))) {
    await audit(user.organizationId, { action: "conversation.tag_removed", entity: "Conversation", entityId: conversationId, ...actorOf(user), meta: { tag } });
  }
  revalidatePath("/conversations");
  return { ok: true, tags: next };
}
