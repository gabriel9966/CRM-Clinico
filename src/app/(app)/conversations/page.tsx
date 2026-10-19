import { getConnections, getPipelines, getTeamMembers, getMessageTemplates } from "@/lib/data";
import { listTags } from "@/lib/crm-catalog";
import { getConversationMessagesPage, getConversationsPage } from "@/lib/queries";
import { requireOrgUser } from "@/lib/auth";
import { allowedConnectionIds, hasModulePermission } from "@/lib/access";
import { getSendOptions } from "@/lib/messaging";
import { listAiAgentOptions } from "@/lib/ai/queries";
import { ConversationsView } from "@/components/conversations/ConversationsView";

export default async function ConversationsPage() {
  const user = await requireOrgUser();
  const connectionAccessIds = await allowedConnectionIds(user);
  const sendConnectionAccessIds = await allowedConnectionIds(user, "send");
  const canReadConversations = hasModulePermission(user, "conversations.read");

  // Permissão: ADMIN vê todas as conversas da empresa; MEMBER só vê as dos
  // contatos atribuídos a ele(a) — evita que um atendente leia a conversa
  // de um lead de outro atendente. A regra é aplicada na consulta.
  const [page, team, templates, pipelines, connections, tags] = await Promise.all([
    canReadConversations ? getConversationsPage(user.organizationId, { restrictToOwnerId: hasModulePermission(user, "conversations.manage") ? undefined : user.id, allowedConnectionIds: connectionAccessIds ?? undefined }) : Promise.resolve({ items: [], nextCursor: null, total: 0 }),
    getTeamMembers(user.organizationId),
    getMessageTemplates(user.organizationId),
    getPipelines(user.organizationId),
    getConnections(user.organizationId).then((items) => connectionAccessIds === null ? items : items.filter((item) => connectionAccessIds.includes(item.id))),
    listTags(user.organizationId, "contact"),
  ]);

  // Só a primeira página da lista e as mensagens da primeira conversa vêm do
  // servidor; o resto é carregado sob demanda.
  const firstId = page.items[0]?.id;
  const [firstThread, firstSendOptions] = await Promise.all([
    firstId ? getConversationMessagesPage(user.organizationId, { id: user.id, role: user.role }, firstId) : Promise.resolve(null),
    firstId
      ? getSendOptions(user.organizationId, page.items[0]!.contact.id).then((options) => options.filter((option) =>
        (sendConnectionAccessIds === null || sendConnectionAccessIds.includes(option.connectionId)) &&
        (!page.items[0]!.channel?.connectionId || option.connectionId === page.items[0]!.channel!.connectionId)
      ))
      : Promise.resolve([]),
  ]);

  const aiEnabled = (await listAiAgentOptions(user.organizationId)).some((agent) => agent.enabled);

  return (
    <ConversationsView
      aiEnabled={aiEnabled}
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
