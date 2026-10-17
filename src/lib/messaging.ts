import "server-only";
import { prisma } from "./prisma";
import { decryptJson } from "./crypto";
import { createMessage } from "./messages";
import * as evolution from "./providers/evolution";
import * as instagram from "./providers/instagram";
import * as email from "./providers/email";
import * as azap from "./providers/azap";
import * as whatsappCloud from "./providers/whatsapp-cloud";
import type { SendOptionDTO } from "./types";

// Toda conversa acontece por um CANAL real (WhatsApp, Instagram ou e-mail),
// ligado a uma Connection. Antes, quando o contato não tinha canal, o CRM
// gravava a mensagem como "enviada" sem enviar nada — o atendente achava que o
// paciente tinha sido avisado e não tinha. Agora só se grava mensagem de saída
// quando há um canal; se o envio ao provedor falha, a mensagem fica registrada
// como "failed" (visível na tela), e sem canal o envio é recusado com o motivo.

export type SendErrorCode =
  | "texto_vazio"
  | "contato_nao_encontrado"
  | "sem_canal"
  | "canal_desconectado"
  | "canal_invalido"
  | "escolha_canal"
  | "canal_em_uso"
  | "janela_24h_encerrada";

export type SendResult =
  | { ok: true; status: "sent" | "failed"; messageId: string; connectionId: string; error?: string }
  | { ok: false; code: SendErrorCode; error: string };

const MESSAGES: Record<SendErrorCode, string> = {
  texto_vazio: "Escreva a mensagem antes de enviar.",
  contato_nao_encontrado: "Contato não encontrado nesta organização.",
  sem_canal:
    "Este contato não tem um canal de conversa. Conecte o WhatsApp ou o Instagram em Conexões e cadastre o telefone do contato (ou espere ele escrever primeiro, no caso do Instagram).",
  canal_desconectado: "O canal deste contato está desconectado. Reconecte-o em Conexões.",
  canal_invalido: "Esse canal não pode ser usado para este contato.",
  escolha_canal: "Este contato pode ser atendido por mais de um canal. Escolha por qual enviar.",
  canal_em_uso: "Este telefone/e-mail já pertence a outro contato nesse canal.",
  janela_24h_encerrada: "A janela de atendimento da API oficial terminou. Envie um template aprovado pela Meta para iniciar uma nova conversa; mensagens livres só podem ser enviadas até 24 horas após a última mensagem do cliente.",
};

const fail = (code: SendErrorCode, extra?: string): SendResult => ({
  ok: false,
  code,
  error: extra ? `${MESSAGES[code]} ${extra}` : MESSAGES[code],
});

// Telefone cadastrado como "(47) 98888-7777" vira o número do WhatsApp com DDI.
export function whatsappNumber(phone: string): string | null {
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 10) return null;
  return digits.length <= 11 ? `55${digits}` : digits; // 10–11 dígitos = sem DDI: assume Brasil
}

type Opt = {
  connectionId: string;
  provider: SendOptionDTO["provider"];
  label: string;
  connected: boolean;
  channelId: string | null;
  externalId: string; // destino: jid, e-mail ou IGSID
};

async function loadOptions(organizationId: string, contactId: string) {
  const contact = await prisma.contact.findFirst({
    where: { id: contactId, organizationId },
    select: { id: true, name: true, phone: true, email: true },
  });
  if (!contact) return null;

  const [channels, connections] = await Promise.all([
    prisma.contactChannel.findMany({
      where: { contactId, connection: { organizationId } },
      include: { connection: true },
      orderBy: { createdAt: "desc" },
    }),
    prisma.connection.findMany({ where: { organizationId }, orderBy: { createdAt: "asc" } }),
  ]);

  const options: Opt[] = channels.map((ch) => ({
    connectionId: ch.connectionId,
    provider: ch.connection.provider as Opt["provider"],
    label: ch.connection.label,
    connected: ch.connection.status === "CONNECTED",
    channelId: ch.id,
    externalId: ch.externalId,
  }));

  // Canais que ainda não existem para este contato, mas podem ser iniciados
  // pelo CRM: WhatsApp (precisa de telefone) e e-mail (precisa de e-mail).
  // Instagram só nasce quando a pessoa escreve primeiro (precisamos do IGSID).
  const have = new Set(options.map((o) => o.connectionId));
  const wa = contact.phone ? whatsappNumber(contact.phone) : null;
  for (const c of connections) {
    if (have.has(c.id)) continue;
    if ((c.provider === "WHATSAPP_EVOLUTION" || c.provider === "WHATSAPP_AZAP" || c.provider === "WHATSAPP_CLOUD") && wa) {
      options.push({ connectionId: c.id, provider: c.provider as Opt["provider"], label: c.label, connected: c.status === "CONNECTED", channelId: null, externalId: c.provider === "WHATSAPP_EVOLUTION" ? `${wa}@s.whatsapp.net` : wa });
    } else if (c.provider === "EMAIL" && contact.email) {
      options.push({ connectionId: c.id, provider: "EMAIL", label: c.label, connected: c.status === "CONNECTED", channelId: null, externalId: contact.email.trim().toLowerCase() });
    }
  }
  return { contact, options };
}

/** Canais pelos quais dá para falar com o contato, para a tela mostrar/escolher. */
export async function getSendOptions(organizationId: string, contactId: string): Promise<SendOptionDTO[]> {
  const loaded = await loadOptions(organizationId, contactId);
  if (!loaded) return [];
  return loaded.options.map((o) => ({
    connectionId: o.connectionId,
    provider: o.provider,
    label: o.label,
    connected: o.connected,
    existing: o.channelId !== null,
  }));
}

async function deliver(connectionId: string, provider: Opt["provider"], destination: string, text: string) {
  const conn = await prisma.connection.findUniqueOrThrow({ where: { id: connectionId } });
  if (provider === "WHATSAPP_EVOLUTION") {
    await evolution.sendText(decryptJson<evolution.EvolutionConfig>(conn.config), destination, text);
  } else if (provider === "WHATSAPP_AZAP") {
    await azap.sendText(decryptJson<azap.AzapConfig>(conn.config), destination, text);
  } else if (provider === "WHATSAPP_CLOUD") {
    await whatsappCloud.sendText(decryptJson<whatsappCloud.WhatsAppCloudConfig>(conn.config), destination, text);
  } else if (provider === "INSTAGRAM") {
    await instagram.sendText(decryptJson<instagram.InstagramConfig>(conn.config), destination, text);
  } else {
    await email.sendText(decryptJson<email.EmailConfig>(conn.config), destination, text);
  }
}

/**
 * Envia uma mensagem a um contato por um canal real e registra no histórico.
 * `connectionId` escolhe o canal; sem ele, usa o canal conectado mais recente
 * ou, se o contato ainda não tem nenhum, o único canal que puder ser iniciado.
 */
export async function sendContactMessage(
  organizationId: string,
  contactId: string,
  rawText: string,
  opts: { connectionId?: string; senderId?: string; conversationId?: string } = {}
): Promise<SendResult> {
  const text = rawText.trim();
  if (!text) return fail("texto_vazio");

  const loaded = await loadOptions(organizationId, contactId);
  if (!loaded) return fail("contato_nao_encontrado");
  const { options } = loaded;

  let chosen: Opt | undefined;
  if (opts.connectionId) {
    chosen = options.find((o) => o.connectionId === opts.connectionId);
    if (!chosen) return fail("canal_invalido");
    if (!chosen.connected) return fail("canal_desconectado");
  } else {
    const usable = options.filter((o) => o.connected);
    const existing = usable.filter((o) => o.channelId);
    if (existing.length > 0) {
      chosen = existing[0]; // já ordenado: o canal criado mais recentemente
    } else if (usable.length === 1) {
      chosen = usable[0];
    } else if (usable.length > 1) {
      return fail("escolha_canal");
    } else {
      return fail(options.length > 0 ? "canal_desconectado" : "sem_canal");
    }
  }

  // Aplicado no serviço central para cobrir chat, automações, MCP e reenvios.
  if (chosen.provider === "WHATSAPP_CLOUD") {
    const lastInbound = await prisma.message.findFirst({
      where: { organizationId, contactId, connectionId: chosen.connectionId, direction: "in" },
      orderBy: { time: "desc" },
      select: { time: true },
    });
    if (!lastInbound || Date.now() - lastInbound.time.getTime() >= 24 * 60 * 60 * 1000) return fail("janela_24h_encerrada");
  }

  // Primeira conversa por este canal: registra o vínculo contato ↔ canal.
  if (!chosen.channelId) {
    try {
      await prisma.contactChannel.create({
        data: { contactId, connectionId: chosen.connectionId, externalId: chosen.externalId, externalName: loaded.contact.name },
      });
    } catch (err) {
      if (typeof err === "object" && err && (err as { code?: string }).code === "P2002") return fail("canal_em_uso");
      throw err;
    }
  }

  let status: "sent" | "failed" = "sent";
  let error: string | undefined;
  try {
    await deliver(chosen.connectionId, chosen.provider, chosen.externalId, text);
  } catch (err) {
    status = "failed";
    error = err instanceof Error ? err.message : "Falha ao enviar pelo canal.";
  }

  const message = await createMessage(prisma, {
    organizationId,
    contactId,
    text,
    direction: "out",
    senderId: opts.senderId ?? null,
    connectionId: chosen.connectionId,
    conversationId: opts.conversationId ?? null,
    status,
  });
  return { ok: true, status, messageId: message.id, connectionId: chosen.connectionId, ...(error ? { error } : {}) };
}
