import { requireAdminPage } from "@/lib/auth";
import { listTags } from "@/lib/crm-catalog";
import { TagsView } from "@/components/tags/TagsView";

export default async function TagsPage() {
  // Página: atendente comum volta ao dashboard (requireAdminUser é para server actions e lança erro).
  const { organizationId } = await requireAdminPage();
  const tags = await listTags(organizationId);
  return <TagsView tags={tags.map((tag) => ({ id: tag.id, name: tag.name, color: tag.color, contacts: tag.contacts, opportunities: tag.opportunities }))} />;
}
