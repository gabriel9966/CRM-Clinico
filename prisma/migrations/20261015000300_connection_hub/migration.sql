ALTER TYPE "ConnectionProvider" ADD VALUE IF NOT EXISTS 'WHATSAPP_AZAP';
ALTER TYPE "ConnectionProvider" ADD VALUE IF NOT EXISTS 'WHATSAPP_CLOUD';

CREATE TABLE "WebhookLog" (
  "id" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "event" TEXT,
  "statusCode" INTEGER NOT NULL,
  "detail" TEXT,
  "payload" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "organizationId" TEXT NOT NULL,
  "connectionId" TEXT,
  CONSTRAINT "WebhookLog_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "InboundWebhook" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "mapping" TEXT NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "organizationId" TEXT NOT NULL,
  CONSTRAINT "InboundWebhook_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "WebhookLog_organizationId_createdAt_idx" ON "WebhookLog"("organizationId", "createdAt");
CREATE INDEX "WebhookLog_connectionId_createdAt_idx" ON "WebhookLog"("connectionId", "createdAt");
CREATE INDEX "InboundWebhook_organizationId_idx" ON "InboundWebhook"("organizationId");

ALTER TABLE "WebhookLog" ADD CONSTRAINT "WebhookLog_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WebhookLog" ADD CONSTRAINT "WebhookLog_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "Connection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InboundWebhook" ADD CONSTRAINT "InboundWebhook_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
