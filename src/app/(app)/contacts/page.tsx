import { getTeamMembers, getPipelines, getCustomFieldDefinitions, findDuplicateContacts, getSegments } from "@/lib/data";
import { getContactsPage } from "@/lib/queries";
import { requireOrgUser } from "@/lib/auth";
import { ContactsView } from "@/components/contacts/ContactsView";
import { allowedPipelineIds, hasModulePermission } from "@/lib/access";

export default async function ContactsPage({ searchParams }: { searchParams: Promise<{ q?: string; contact?: string }> }) {
  const user = await requireOrgUser();
  const { organizationId } = user;
  if (!hasModulePermission(user, "contacts.read")) return <div className="content"><h1>Contatos</h1><p>Você não tem acesso a este módulo. Solicite a liberação ao administrador.</p></div>;
  const pipelineIds = hasModulePermission(user, "pipeline.read") ? await allowedPipelineIds(user) : [];
  const { q, contact } = await searchParams;

  // Só a primeira página de contatos vem renderizada; o resto é carregado sob
  // demanda pela tela. Negócios e conversa de cada contato são buscados ao abrir o detalhe.
  const [page, team, pipelines, customFieldDefs, duplicates, segments] = await Promise.all([
    getContactsPage(organizationId, { q }),
    getTeamMembers(organizationId),
    getPipelines(organizationId).then((items) => pipelineIds ? items.filter((item) => pipelineIds.includes(item.id)) : items),
    getCustomFieldDefinitions(organizationId),
    findDuplicateContacts(organizationId),
    getSegments(organizationId),
  ]);

  return (
    <ContactsView
      initialPage={page}
      initialQuery={q ?? ""}
      initialContactId={contact ?? null}
      duplicateCount={duplicates.length}
      team={team}
      pipelines={pipelines}
      customFieldDefs={customFieldDefs}
      segments={segments.filter((s) => s.entity === "CONTACT")}
    />
  );
}
