import { getTeamMembers, getMessageTemplates } from "@/lib/data";
import { getChannelsFor, getConversationsPage, getMessagesPage } from "@/lib/queries";
import { requireOrgUser } from "@/lib/auth";
import { getSendOptions } from "@/lib/messaging";
import { ConversationsView } from "@/components/conversations/ConversationsView";

export default async function ConversationsPage() {
  const user = await requireOrgUser();

  // Permissão: ADMIN vê todas as conversas da empresa; MEMBER só vê as dos
  // contatos atribuídos a ele(a) — evita que um atendente leia a conversa
  // de um lead de outro atendente. A regra é aplicada na consulta.
  const [page, team, templates] = await Promise.all([
    getConversationsPage(user.organizationId, { restrictToOwnerId: user.role === "ADMIN" ? undefined : user.id }),
    getTeamMembers(user.organizationId),
    getMessageTemplates(user.organizationId),
  ]);

  // Só a primeira página da lista e as mensagens da primeira conversa vêm do
  // servidor; o resto é carregado sob demanda.
  const firstId = page.items[0]?.contact.id;
  const [channels, firstThread, firstSendOptions] = await Promise.all([
    getChannelsFor(user.organizationId, page.items.map((r) => r.contact.id)),
    firstId ? getMessagesPage(user.organizationId, { id: user.id, role: user.role }, firstId) : Promise.resolve(null),
    firstId ? getSendOptions(user.organizationId, firstId) : Promise.resolve([]),
  ]);

  return (
    <ConversationsView
      initialPage={page}
      initialChannels={channels}
      initialThread={firstThread}
      initialSendOptions={firstSendOptions}
      team={team}
      currentUserRole={user.role}
      templates={templates}
    />
  );
}
