ALTER TYPE "AutomationTrigger" ADD VALUE IF NOT EXISTS 'APPOINTMENT_CREATED';
ALTER TYPE "AutomationTrigger" ADD VALUE IF NOT EXISTS 'APPOINTMENT_RESCHEDULED';
ALTER TYPE "AutomationTrigger" ADD VALUE IF NOT EXISTS 'APPOINTMENT_CANCELLED';
ALTER TYPE "AutomationTrigger" ADD VALUE IF NOT EXISTS 'APPOINTMENT_CONFIRMED';
ALTER TYPE "AutomationTrigger" ADD VALUE IF NOT EXISTS 'APPOINTMENT_NO_SHOW';
ALTER TYPE "AutomationTrigger" ADD VALUE IF NOT EXISTS 'APPOINTMENT_STARTING';

ALTER TABLE "AutomationRun" ADD COLUMN "appointmentId" TEXT;
CREATE INDEX "AutomationRun_appointmentId_idx" ON "AutomationRun"("appointmentId");
CREATE UNIQUE INDEX "AutomationRun_automationId_appointmentId_key" ON "AutomationRun"("automationId", "appointmentId");
