import { getConnections, getPipelines, getTeamMembers, getMessageTemplates } from "@/lib/data";
import { listTags } from "@/lib/crm-catalog";
import { getConversationMessagesPage, getConversationsPage } from "@/lib/queries";
import { requireOrgUser } from "@/lib/auth";
import { getSendOptions } from "@/lib/messaging";
import { ConversationsView } from "@/components/conversations/ConversationsView";

export default async function ConversationsPage() {
  const user = await requireOrgUser();

  // Permissão: ADMIN vê todas as conversas da empresa; MEMBER só vê as dos
  // contatos atribuídos a ele(a) — evita que um atendente leia a conversa
  // de um lead de outro atendente. A regra é aplicada na consulta.
  const [page, team, templates, pipelines, connections, tags] = await Promise.all([
    getConversationsPage(user.organizationId, { restrictToOwnerId: user.role === "ADMIN" ? undefined : user.id }),
    getTeamMembers(user.organizationId),
    getMessageTemplates(user.organizationId),
    getPipelines(user.organizationId),
    getConnections(user.organizationId),
    listTags(user.organizationId),
  ]);

  // Só a primeira página da lista e as mensagens da primeira conversa vêm do
  // servidor; o resto é carregado sob demanda.
  const firstId = page.items[0]?.id;
  const [firstThread, firstSendOptions] = await Promise.all([
    firstId ? getConversationMessagesPage(user.organizationId, { id: user.id, role: user.role }, firstId) : Promise.resolve(null),
    firstId && page.items[0]!.channel?.connectionId
      ? getSendOptions(user.organizationId, page.items[0]!.contact.id).then((options) => options.filter((option) => option.connectionId === page.items[0]!.channel!.connectionId))
      : Promise.resolve([]),
  ]);

  return (
    <ConversationsView
      initialPage={page}
      initialThread={firstThread}
      initialSendOptions={firstSendOptions}
      team={team}
      currentUserRole={user.role}
      currentUserId={user.id}
      templates={templates}
      pipelines={pipelines}
      connections={connections}
      tags={tags.map((tag) => tag.name)}
    />
  );
}
