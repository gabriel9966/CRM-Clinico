import { getConnections } from "@/lib/data";
import { requireAdminPage } from "@/lib/auth";
import { ConnectionsView } from "@/components/connections/ConnectionsView";
import { prisma } from "@/lib/prisma";

export default async function ConnectionsPage() {
  const { organizationId } = await requireAdminPage();
  const [connections, inboundWebhooks, webhookLogs] = await Promise.all([
    getConnections(organizationId),
    prisma.inboundWebhook.findMany({ where: { organizationId }, orderBy: { createdAt: "desc" } }),
    prisma.webhookLog.findMany({ where: { organizationId }, orderBy: { createdAt: "desc" }, take: 30, select: { id: true, source: true, event: true, statusCode: true, detail: true, createdAt: true, connectionId: true } }),
  ]);
  return <ConnectionsView connections={connections} inboundWebhooks={inboundWebhooks.map((item) => ({ ...item, createdAt: item.createdAt.toISOString() }))} webhookLogs={webhookLogs.map((item) => ({ ...item, createdAt: item.createdAt.toISOString() }))} />;
}
