ALTER TABLE "AutomationRun" ADD COLUMN "appointmentStartAt" TIMESTAMP(3);
DROP INDEX IF EXISTS "AutomationRun_automationId_appointmentId_key";
CREATE UNIQUE INDEX "AutomationRun_automationId_appointmentId_appointmentStartAt_key"
  ON "AutomationRun"("automationId", "appointmentId", "appointmentStartAt");
