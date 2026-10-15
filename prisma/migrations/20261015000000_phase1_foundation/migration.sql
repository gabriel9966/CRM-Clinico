-- AlterTable
ALTER TABLE "McpConfig" ADD COLUMN     "apiKeyHash" TEXT;

-- AlterTable
ALTER TABLE "Procedure" ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'PROCEDURE',
ADD COLUMN     "sessions" INTEGER;

-- AlterTable
ALTER TABLE "AuditLog" ADD COLUMN     "actorName" TEXT,
ADD COLUMN     "ip" TEXT;

-- AlterTable
ALTER TABLE "Appointment" ADD COLUMN     "deletedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Contact" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "lastMessageAt" TIMESTAMP(3),
ADD COLUMN     "lastMessageDirection" TEXT,
ADD COLUMN     "lastMessageText" TEXT;

-- AlterTable
ALTER TABLE "Opportunity" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "lossReasonId" TEXT;

-- CreateTable
CREATE TABLE "Tag" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#64748b',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "organizationId" TEXT NOT NULL,

    CONSTRAINT "Tag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LossReason" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "organizationId" TEXT NOT NULL,

    CONSTRAINT "LossReason_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OpportunityItem" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unitCents" INTEGER NOT NULL DEFAULT 0,
    "discountCents" INTEGER NOT NULL DEFAULT 0,
    "organizationId" TEXT NOT NULL,
    "opportunityId" TEXT NOT NULL,
    "procedureId" TEXT,

    CONSTRAINT "OpportunityItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Tag_organizationId_name_key" ON "Tag"("organizationId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "LossReason_organizationId_name_key" ON "LossReason"("organizationId", "name");

-- CreateIndex
CREATE INDEX "OpportunityItem_opportunityId_idx" ON "OpportunityItem"("opportunityId");

-- CreateIndex
CREATE INDEX "OpportunityItem_organizationId_idx" ON "OpportunityItem"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "McpConfig_apiKeyHash_key" ON "McpConfig"("apiKeyHash");

-- CreateIndex
CREATE INDEX "Appointment_organizationId_deletedAt_startAt_idx" ON "Appointment"("organizationId", "deletedAt", "startAt");

-- CreateIndex
CREATE INDEX "Contact_organizationId_deletedAt_createdAt_idx" ON "Contact"("organizationId", "deletedAt", "createdAt");

-- CreateIndex
CREATE INDEX "Contact_organizationId_lastMessageAt_idx" ON "Contact"("organizationId", "lastMessageAt");

-- CreateIndex
CREATE INDEX "Contact_organizationId_ownerId_idx" ON "Contact"("organizationId", "ownerId");

-- CreateIndex
CREATE INDEX "Opportunity_organizationId_deletedAt_createdAt_idx" ON "Opportunity"("organizationId", "deletedAt", "createdAt");

-- CreateIndex
CREATE INDEX "Opportunity_pipelineId_stageId_deletedAt_idx" ON "Opportunity"("pipelineId", "stageId", "deletedAt");

-- CreateIndex
CREATE INDEX "Message_contactId_time_idx" ON "Message"("contactId", "time");

-- AddForeignKey
ALTER TABLE "Opportunity" ADD CONSTRAINT "Opportunity_lossReasonId_fkey" FOREIGN KEY ("lossReasonId") REFERENCES "LossReason"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Tag" ADD CONSTRAINT "Tag_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LossReason" ADD CONSTRAINT "LossReason_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpportunityItem" ADD CONSTRAINT "OpportunityItem_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpportunityItem" ADD CONSTRAINT "OpportunityItem_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "Opportunity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpportunityItem" ADD CONSTRAINT "OpportunityItem_procedureId_fkey" FOREIGN KEY ("procedureId") REFERENCES "Procedure"("id") ON DELETE SET NULL ON UPDATE CASCADE;

