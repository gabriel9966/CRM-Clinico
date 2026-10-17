import { requireAdminPage } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getConnections, getMessageTemplates, getSegments } from "@/lib/data";
import { CampaignsView } from "@/components/campaigns/CampaignsView";
import type { CampaignDTO } from "@/lib/types";

export default async function CampaignsPage() {
  const { organizationId } = await requireAdminPage();
  const [campaigns, recipientStats, connections, segments, templates] = await Promise.all([
    prisma.campaign.findMany({
      where: { organizationId }, orderBy: { createdAt: "desc" }, take: 30,
      include: { connection: true, segment: true, recipients: { include: { contact: { select: { id: true, name: true, marketingOptOut: true, opportunities: { select: { createdAt: true } } } } }, orderBy: { id: "desc" }, take: 12 } },
    }),
    prisma.campaignRecipient.findMany({ where: { campaign: { organizationId } }, select: { campaignId: true, status: true, sentAt: true, contact: { select: { opportunities: { select: { createdAt: true } } } } } }),
    getConnections(organizationId), getSegments(organizationId), getMessageTemplates(organizationId),
  ]);
  const rows: CampaignDTO[] = campaigns.map((campaign) => {
    const all = recipientStats.filter((recipient) => recipient.campaignId === campaign.id);
    const count = (status: string) => all.filter((recipient) => recipient.status === status).length;
    return {
      id: campaign.id, name: campaign.name, body: campaign.body, status: campaign.status,
      scheduledAt: campaign.scheduledAt?.toISOString() ?? null, createdAt: campaign.createdAt.toISOString(),
      connectionId: campaign.connectionId, connectionLabel: campaign.connection.label, connectionProvider: campaign.connection.provider,
      segmentId: campaign.segmentId, segmentName: campaign.segment?.name ?? null,
      sendLimit: campaign.sendLimit, batchSize: campaign.batchSize, intervalMinutes: campaign.intervalMinutes, duplicateWindowHours: campaign.duplicateWindowHours, dailyLimit: campaign.dailyLimit, sendWindowStart: campaign.sendWindowStart, sendWindowEnd: campaign.sendWindowEnd,
      metrics: {
        total: all.length, pending: count("PENDING") + count("SENDING"), sent: count("SENT"), delivered: count("DELIVERED"), read: count("READ"), responded: count("RESPONDED"), failed: count("FAILED"), skipped: count("SKIPPED"),
        conversions: all.filter((recipient) => recipient.sentAt && recipient.contact.opportunities.some((opportunity) => opportunity.createdAt >= recipient.sentAt!)).length,
      },
      recipients: campaign.recipients.map((recipient) => ({ id: recipient.id, contactId: recipient.contactId, contactName: recipient.contact.name, status: recipient.status, failureReason: recipient.failureReason, sentAt: recipient.sentAt?.toISOString() ?? null, optedOut: recipient.contact.marketingOptOut })),
    };
  });
  return <CampaignsView campaigns={rows} connections={connections.filter((connection) => ["WHATSAPP_EVOLUTION", "WHATSAPP_AZAP", "WHATSAPP_CLOUD"].includes(connection.provider))} segments={segments.filter((segment) => segment.entity === "CONTACT")} templates={templates} />;
}
