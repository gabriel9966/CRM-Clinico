import { getOrCreateMcpApiKey } from "@/lib/mcp-config";
import { requireAdminPage } from "@/lib/auth";
import { McpSettingsView } from "@/components/mcp/McpSettingsView";

export default async function McpPage() {
  const { organizationId } = await requireAdminPage();
  const apiKey = await getOrCreateMcpApiKey(organizationId);
  return <McpSettingsView apiKey={apiKey} />;
}
