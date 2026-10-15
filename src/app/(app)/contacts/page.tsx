import { getTeamMembers, getPipelines, getCustomFieldDefinitions, findDuplicateContacts, getSegments } from "@/lib/data";
import { getContactsPage } from "@/lib/queries";
import { requireOrgUser } from "@/lib/auth";
import { ContactsView } from "@/components/contacts/ContactsView";

export default async function ContactsPage({ searchParams }: { searchParams: Promise<{ q?: string; contact?: string }> }) {
  const { organizationId } = await requireOrgUser();
  const { q, contact } = await searchParams;

  // Só a primeira página de contatos vem renderizada; o resto é carregado sob
  // demanda pela tela. Negócios e conversa de cada contato são buscados ao abrir o detalhe.
  const [page, team, pipelines, customFieldDefs, duplicates, segments] = await Promise.all([
    getContactsPage(organizationId, { q }),
    getTeamMembers(organizationId),
    getPipelines(organizationId),
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
