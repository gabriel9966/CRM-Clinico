"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireOrgUser } from "@/lib/auth";
import { decryptJson } from "@/lib/crypto";
import { createMessage } from "@/lib/messages";
import * as evolution from "@/lib/providers/evolution";
import * as instagram from "@/lib/providers/instagram";
import * as email from "@/lib/providers/email";

export async function sendMessage(contactId: string, text: string) {
  const user = await requireOrgUser();
  const trimmed = text.trim();
  if (!trimmed) return;

  const contact = await prisma.contact.findFirst({ where: { id: contactId, organizationId: user.organizationId } });
  if (!contact) return;
  // MEMBER só pode falar com contatos atribuídos a ele(a) — mesma regra de
  // visibilidade da tela de Conversas, aplicada aqui pra não dar pra burlar
  // só adivinhando o id de um contato de outro atendente.
  if (user.role !== "ADMIN" && contact.ownerId !== user.id) return;

  // Se o contato tiver um canal real conectado (WhatsApp/Instagram), envia de
  // verdade por ali; senão cai no modo demo (mensagem só fica salva no CRM).
  const channel = await prisma.contactChannel.findFirst({
    where: { contactId },
    include: { connection: true },
    orderBy: { createdAt: "desc" },
  });

  let status: "sent" | "failed" = "sent";
  let connectionId: string | null = null;

  if (channel && channel.connection.status === "CONNECTED") {
    connectionId = channel.connectionId;
    try {
      if (channel.connection.provider === "WHATSAPP_EVOLUTION") {
        const config = decryptJson<evolution.EvolutionConfig>(channel.connection.config);
        await evolution.sendText(config, channel.externalId, trimmed);
      } else if (channel.connection.provider === "INSTAGRAM") {
        const config = decryptJson<instagram.InstagramConfig>(channel.connection.config);
        await instagram.sendText(config, channel.externalId, trimmed);
      } else if (channel.connection.provider === "EMAIL") {
        const config = decryptJson<email.EmailConfig>(channel.connection.config);
        await email.sendText(config, channel.externalId, trimmed);
      }
    } catch {
      status = "failed";
    }
  }

  await createMessage(prisma, {
    organizationId: user.organizationId,
    contactId,
    text: trimmed,
    direction: "out",
    senderId: user.id,
    connectionId,
    status,
  });
  revalidatePath("/conversations");

  return { usedRealChannel: Boolean(channel && channel.connection.status === "CONNECTED"), status };
}

// Resposta simulada, só para dar vida à demonstração em contatos SEM canal
// real conectado — chamada pelo cliente alguns segundos após o envio.
export async function simulateReply(contactId: string) {
  // Só existe para demonstração. Em produção, um contato sem canal nunca deve
  // receber "resposta" inventada: ficaria no histórico como se fosse do cliente.
  if (process.env.DEMO_MODE !== "true") return;
  const { organizationId } = await requireOrgUser();
  const contact = await prisma.contact.findFirst({ where: { id: contactId, organizationId } });
  if (!contact) return;

  const channel = await prisma.contactChannel.findFirst({ where: { contactId } });
  if (channel) return; // contato real: a resposta vem pelo webhook, não simulamos

  const replies = [
    "Perfeito, obrigado pelo retorno!",
    "Combinado, vou verificar por aqui.",
    "Ok! Fico no aguardo então.",
    "Legal, pode seguir com isso.",
  ];
  const reply = replies[Math.floor(Math.random() * replies.length)];
  await createMessage(prisma, { organizationId, contactId, text: reply, direction: "in" });
  revalidatePath("/conversations");
}
