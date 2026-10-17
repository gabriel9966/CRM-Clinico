-- Instalação em bases que já receberam reentregas: preserva a primeira cópia
-- antes de criar a garantia de unicidade.
DELETE FROM "Message" duplicate
USING "Message" canonical
WHERE duplicate."connectionId" = canonical."connectionId"
  AND duplicate."externalMessageId" = canonical."externalMessageId"
  AND duplicate."connectionId" IS NOT NULL
  AND duplicate."externalMessageId" IS NOT NULL
  AND duplicate.id > canonical.id;

CREATE UNIQUE INDEX IF NOT EXISTS "Message_connectionId_externalMessageId_key"
  ON "Message"("connectionId", "externalMessageId");
