import { getCustomFieldDefinitions } from "@/lib/data";
import { requireAdminPage } from "@/lib/auth";
import { CustomFieldsView } from "@/components/custom-fields/CustomFieldsView";

export default async function CustomFieldsPage() {
  const { organizationId } = await requireAdminPage();
  const fields = await getCustomFieldDefinitions(organizationId);
  return <CustomFieldsView fields={fields} />;
}
