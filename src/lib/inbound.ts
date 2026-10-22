import "server-only";
import { prisma, prismaRaw } from "./prisma";
import { assignNextOwner } from "./assignment";

// Variações do mesmo telefone brasileiro, só dígitos: com e sem DDI 55 e com e
// sem o nono dígito do celular. O CRM guarda telefones como foram digitados
// ("(11) 98888-1234", "11988881234") e os canais entregam "5511988881234" —
// comparar texto exato criava um contato duplicado para cada pessoa.
export function phoneVariants(phone: string): string[] {
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 8) return [];
  const national = (digits.length === 12 || digits.length === 13) && digits.startsWith("55") ? digits.slice(2) : digits;
  const forms = new Set([digits, national]);
  if (national.length === 11 && national[2] === "9") forms.add(national.slice(0, 2) + national.slice(3));
  if (national.length === 10 && /[6-9]/.test(national[2])) forms.add(national.slice(0, 2) + "9" + national.slice(2));
  for (const form of [...forms]) if (form.length === 10 || form.length === 11) forms.add(`55${form}`);
  return [...forms];
}

/** Contato ativo da organização com este telefone (em qualquer formatação). */
export async function findContactByPhone(organizationId: string, phone: string): Promise<{ id: string } | null> {
  const variants = phoneVariants(phone);
  if (!variants.length) return null;
  // $queryRaw não passa pela extensão da lixeira: "deletedAt" IS NULL explícito.
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    SELECT id FROM "Contact"
    WHERE "organizationId" = ${organizationId} AND "deletedAt" IS NULL
      AND phone IS NOT NULL AND regexp_replace(phone, '\\D', '', 'g') = ANY(${variants})
    ORDER BY "createdAt" ASC, id ASC
    LIMIT 1`;
  return rows[0] ?? null;
}

async function findContactByEmail(organizationId: string, email: string) {
  return prisma.contact.findFirst({
    where: { organizationId, email: { equals: email.trim(), mode: "insensitive" } },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
}

type Identity = { name: string; phone?: string; email?: string };

async function matchOrCreate(organizationId: string, who: Identity, match: boolean) {
  const existing = match
    ? (who.phone && (await findContactByPhone(organizationId, who.phone))) || (who.email && (await findContactByEmail(organizationId, who.email))) || null
    : null;
  if (existing) return { id: existing.id, created: false };
  const contact = await prisma.contact.create({
    data: { organizationId, name: who.name, phone: who.phone, email: who.email, ownerId: await assignNextOwner(organizationId) },
  });
  return { id: contact.id, created: true };
}

// Mensagem que chega por um canal (WhatsApp/e-mail/Instagram) cujo contato foi
// para a lixeira não pode cair nesse contato: ele está invisível e o cliente
// ficaria sem atendimento. Aqui garantimos um contato ativo: reaproveita um
// existente (mesmo telefone/e-mail) ou cria outro, e reaponta o canal.
// (O contato apagado continua na lixeira, restaurável.)
export async function ensureLiveContact(
  channel: { id: string; contactId: string },
  organizationId: string,
  fallback: Identity
): Promise<string> {
  return (await ensureLive(channel, organizationId, fallback)).id;
}

async function ensureLive(channel: { id: string; contactId: string }, organizationId: string, who: Identity) {
  const live = await prisma.contact.findFirst({ where: { id: channel.contactId, organizationId }, select: { id: true } });
  if (live) return { id: live.id, created: false };
  const contact = await matchOrCreate(organizationId, who, true);
  await prisma.contactChannel.update({ where: { id: channel.id }, data: { contactId: contact.id } });
  return contact;
}

/**
 * Porta única dos webhooks de canal: acha o contato da conversa pelo vínculo
 * do canal ou, na primeira mensagem, por telefone/e-mail já cadastrado; senão
 * cria. `created` avisa o chamador para disparar "Novo contato criado".
 * `match: false` (Instagram) não tenta casar: o IGSID não tem telefone/e-mail.
 */
export async function resolveInboundContact(input: {
  organizationId: string;
  connectionId: string;
  externalId: string;
  who: Identity;
  match?: boolean;
}): Promise<{ contactId: string; created: boolean }> {
  const { organizationId, connectionId, externalId, who } = input;
  const key = { connectionId_externalId: { connectionId, externalId } };
  let channel = await prisma.contactChannel.findUnique({ where: key });
  let created = false;
  if (!channel) {
    const contact = await matchOrCreate(organizationId, who, input.match !== false);
    try {
      channel = await prisma.contactChannel.create({ data: { connectionId, externalId, externalName: who.name, contactId: contact.id } });
      created = contact.created;
    } catch (err) {
      // Duas mensagens da mesma pessoa ao mesmo tempo: a outra requisição criou
      // o vínculo primeiro. Usa o dela e descarta o contato criado aqui.
      if ((err as { code?: string })?.code !== "P2002") throw err;
      channel = await prisma.contactChannel.findUniqueOrThrow({ where: key });
      // Só descarta o contato criado aqui se o vínculo vencedor não o usa: a
      // outra requisição pode tê-lo achado pelo telefone e ligado ao canal.
      // Exclusão física de propósito: o contato acabou de nascer, sem histórico.
      if (contact.created && channel.contactId !== contact.id) {
        await prismaRaw.contact.deleteMany({ where: { id: contact.id, organizationId, channels: { none: {} } } });
      }
    }
  }
  const live = await ensureLive(channel, organizationId, who);
  return { contactId: live.id, created: created || live.created };
}
