import { getCustomFieldDefinitions } from "@/lib/data";
import { requireOrgUser } from "@/lib/auth";
import { CustomFieldsView } from "@/components/custom-fields/CustomFieldsView";

export default async function CustomFieldsPage() {
  const { organizationId } = await requireOrgUser();
  const fields = await getCustomFieldDefinitions(organizationId);
  return <CustomFieldsView fields={fields} />;
}
