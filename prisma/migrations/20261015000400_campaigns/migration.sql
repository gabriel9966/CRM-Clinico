CREATE TYPE "CampaignStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'RUNNING', 'PAUSED', 'COMPLETED', 'CANCELLED');
CREATE TYPE "CampaignRecipientStatus" AS ENUM ('PENDING', 'SENDING', 'SENT', 'DELIVERED', 'READ', 'RESPONDED', 'FAILED', 'SKIPPED');

ALTER TABLE "Contact" ADD COLUMN "marketingOptOut" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Contact" ADD COLUMN "marketingOptOutAt" TIMESTAMP(3);
ALTER TABLE "Message" ADD COLUMN "externalMessageId" TEXT;
ALTER TABLE "MessageTemplate" ADD COLUMN "cloudApproved" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "MessageTemplate" ADD COLUMN "cloudTemplateName" TEXT;
ALTER TABLE "MessageTemplate" ADD COLUMN "cloudLanguage" TEXT NOT NULL DEFAULT 'pt_BR';

CREATE TABLE "Campaign" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "status" "CampaignStatus" NOT NULL DEFAULT 'DRAFT',
  "scheduledAt" TIMESTAMP(3),
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "pausedAt" TIMESTAMP(3),
  "nextRunAt" TIMESTAMP(3),
  "sendLimit" INTEGER NOT NULL DEFAULT 1000,
  "batchSize" INTEGER NOT NULL DEFAULT 25,
  "intervalMinutes" INTEGER NOT NULL DEFAULT 1,
  "duplicateWindowHours" INTEGER NOT NULL DEFAULT 24,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "organizationId" TEXT NOT NULL,
  "connectionId" TEXT NOT NULL,
  "segmentId" TEXT,
  "templateId" TEXT,
  CONSTRAINT "Campaign_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CampaignRecipient" (
  "id" TEXT NOT NULL,
  "status" "CampaignRecipientStatus" NOT NULL DEFAULT 'PENDING',
  "sentAt" TIMESTAMP(3),
  "attemptedAt" TIMESTAMP(3),
  "deliveredAt" TIMESTAMP(3),
  "readAt" TIMESTAMP(3),
  "respondedAt" TIMESTAMP(3),
  "failedAt" TIMESTAMP(3),
  "skippedAt" TIMESTAMP(3),
  "failureReason" TEXT,
  "providerMessageId" TEXT,
  "campaignId" TEXT NOT NULL,
  "contactId" TEXT NOT NULL,
  CONSTRAINT "CampaignRecipient_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CampaignRecipient_campaignId_contactId_key" ON "CampaignRecipient"("campaignId", "contactId");
CREATE INDEX "Campaign_organizationId_status_nextRunAt_idx" ON "Campaign"("organizationId", "status", "nextRunAt");
CREATE INDEX "Campaign_connectionId_idx" ON "Campaign"("connectionId");
CREATE INDEX "CampaignRecipient_contactId_sentAt_idx" ON "CampaignRecipient"("contactId", "sentAt");
CREATE INDEX "CampaignRecipient_providerMessageId_idx" ON "CampaignRecipient"("providerMessageId");
CREATE INDEX "CampaignRecipient_campaignId_status_idx" ON "CampaignRecipient"("campaignId", "status");
CREATE INDEX "Message_externalMessageId_idx" ON "Message"("externalMessageId");

ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "Connection"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_segmentId_fkey" FOREIGN KEY ("segmentId") REFERENCES "Segment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "MessageTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CampaignRecipient" ADD CONSTRAINT "CampaignRecipient_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CampaignRecipient" ADD CONSTRAINT "CampaignRecipient_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;
