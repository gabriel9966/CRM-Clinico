import "server-only";
import type { Prisma } from "@prisma/client";
import type { DbClient } from "./prisma";

const PREVIEW_MAX = 200;

/**
 * Único ponto de criação de mensagens. Além de gravar a Message, atualiza o
 * resumo da última mensagem no Contact (lastMessageAt/Text/Direction), que é o
 * que a lista de conversas usa para ordenar e paginar sem varrer o histórico.
 * Nunca recua o resumo: mensagem mais antiga que a última (ex.: reentrega de
 * webhook com timestamp antigo) não sobrescreve.
 */
export async function createMessage(db: DbClient, data: Prisma.MessageUncheckedCreateInput) {
  // Toda mensagem nova fica em um atendimento próprio por canal/instância.
  // Para o legado sem connectionId existe uma conversa sem canal identificada.
  let conversationId = data.conversationId ?? null;
  if (!conversationId) {
    const existing = await db.conversation.findFirst({
      where: {
        organizationId: data.organizationId,
        contactId: data.contactId,
        connectionId: data.connectionId ?? null,
      },
      select: { id: true },
    });
    if (existing) {
      conversationId = existing.id;
    } else {
      const contact = await db.contact.findFirst({ where: { id: data.contactId, organizationId: data.organizationId }, select: { ownerId: true } });
      const conversation = await db.conversation.create({
        data: {
          organizationId: data.organizationId,
          contactId: data.contactId,
          connectionId: data.connectionId ?? null,
          ownerId: contact?.ownerId ?? null,
        },
        select: { id: true },
      });
      conversationId = conversation.id;
    }
  }
  const message = await db.message.create({ data: { ...data, conversationId } });
  await db.contact.updateMany({
    where: {
      id: message.contactId,
      organizationId: message.organizationId,
      OR: [{ lastMessageAt: null }, { lastMessageAt: { lte: message.time } }],
    },
    data: {
      lastMessageAt: message.time,
      lastMessageText: message.text.slice(0, PREVIEW_MAX),
      lastMessageDirection: message.direction,
    },
  });
  await db.conversation.updateMany({
    where: {
      id: conversationId,
      organizationId: message.organizationId,
      OR: [{ lastMessageAt: null }, { lastMessageAt: { lte: message.time } }],
    },
    data: {
      lastMessageAt: message.time,
      lastMessageText: message.text.slice(0, PREVIEW_MAX),
      lastMessageDirection: message.direction,
      // Uma resposta recebida reabre o atendimento automaticamente.
      ...(message.direction === "in" ? { status: "OPEN", closedAt: null } : {}),
    },
  });
  return message;
}

/**
 * Variante para entradas de webhook. Gateways repetem eventos em timeout e
 * alguns enviam o mesmo lote mais de uma vez; com o id do provedor a criação
 * fica idempotente e o chamador sabe se deve (ou não) rodar automações.
 */
export async function createInboundMessage(db: DbClient, data: Prisma.MessageUncheckedCreateInput) {
  if (!data.connectionId || !data.externalMessageId) {
    return { message: await createMessage(db, data), duplicate: false };
  }

  const existing = await db.message.findFirst({
    where: { connectionId: data.connectionId, externalMessageId: data.externalMessageId },
  });
  if (existing) return { message: existing, duplicate: true };

  try {
    return { message: await createMessage(db, data), duplicate: false };
  } catch (error) {
    // Defesa contra concorrência: duas entregas idênticas podem passar pela
    // consulta acima ao mesmo tempo; o índice único decide a vencedora.
    if (typeof error === "object" && error && (error as { code?: string }).code === "P2002") {
      const duplicate = await db.message.findFirst({
        where: { connectionId: data.connectionId, externalMessageId: data.externalMessageId },
      });
      if (duplicate) return { message: duplicate, duplicate: true };
    }
    throw error;
  }
}
