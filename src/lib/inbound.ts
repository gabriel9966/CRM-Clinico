import "server-only";
import { prisma } from "./prisma";
import { assignNextOwner } from "./assignment";

// Mensagem que chega por um canal (WhatsApp/e-mail/Instagram) cujo contato foi
// para a lixeira não pode cair nesse contato: ele está invisível e o cliente
// ficaria sem atendimento. Aqui garantimos um contato ativo: reaproveita um
// existente (mesmo telefone/e-mail) ou cria outro, e reaponta o canal.
// (O contato apagado continua na lixeira, restaurável.)
export async function ensureLiveContact(
  channel: { id: string; contactId: string },
  organizationId: string,
  fallback: { name: string; phone?: string; email?: string }
): Promise<string> {
  const live = await prisma.contact.findFirst({ where: { id: channel.contactId, organizationId }, select: { id: true } });
  if (live) return live.id;

  const match =
    (fallback.phone && (await prisma.contact.findFirst({ where: { organizationId, phone: fallback.phone } }))) ||
    (fallback.email && (await prisma.contact.findFirst({ where: { organizationId, email: fallback.email } }))) ||
    null;

  const contact =
    match ??
    (await prisma.contact.create({
      data: {
        organizationId,
        name: fallback.name,
        phone: fallback.phone,
        email: fallback.email,
        ownerId: await assignNextOwner(organizationId),
      },
    }));

  await prisma.contactChannel.update({ where: { id: channel.id }, data: { contactId: contact.id } });
  return contact.id;
}
