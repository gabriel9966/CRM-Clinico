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
  const message = await db.message.create({ data });
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
  return message;
}
