-- Conversas deixam de ser apenas o histórico agregado do contato. Cada
-- atendimento passa a pertencer a uma conexão/instância específica.
CREATE TYPE "ConversationStatus" AS ENUM ('OPEN', 'CLOSED');

CREATE TABLE "Conversation" (
    "id" TEXT NOT NULL,
    "status" "ConversationStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "closedAt" TIMESTAMP(3),
    "lastMessageAt" TIMESTAMP(3),
    "lastMessageText" TEXT,
    "lastMessageDirection" TEXT,
    "organizationId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "connectionId" TEXT,
    "ownerId" TEXT,
    CONSTRAINT "Conversation_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Message" ADD COLUMN "conversationId" TEXT;

-- Cria uma conversa para cada combinação histórica de contato e conexão. A
-- combinação sem conexão continua acessível como "Histórico sem canal".
INSERT INTO "Conversation" (
  "id", "status", "createdAt", "updatedAt", "lastMessageAt",
  "lastMessageText", "lastMessageDirection", "organizationId", "contactId", "connectionId", "ownerId"
)
SELECT
  'cv_' || replace(gen_random_uuid()::text, '-', ''),
  'OPEN'::"ConversationStatus",
  min(m.time), max(m.time), max(m.time),
  (array_agg(m.text ORDER BY m.time DESC, m.id DESC))[1],
  (array_agg(m.direction ORDER BY m.time DESC, m.id DESC))[1],
  m."organizationId", m."contactId", m."connectionId", c."ownerId"
FROM "Message" m
JOIN "Contact" c ON c.id = m."contactId"
GROUP BY m."organizationId", m."contactId", m."connectionId", c."ownerId";

UPDATE "Message" m
SET "conversationId" = cv.id
FROM "Conversation" cv
WHERE cv."organizationId" = m."organizationId"
  AND cv."contactId" = m."contactId"
  AND cv."connectionId" IS NOT DISTINCT FROM m."connectionId";

CREATE INDEX "Conversation_organizationId_lastMessageAt_idx" ON "Conversation"("organizationId", "lastMessageAt");
CREATE INDEX "Conversation_organizationId_ownerId_status_idx" ON "Conversation"("organizationId", "ownerId", "status");
CREATE INDEX "Conversation_contactId_connectionId_idx" ON "Conversation"("contactId", "connectionId");
CREATE UNIQUE INDEX "Conversation_contactId_connectionId_key" ON "Conversation"("contactId", "connectionId");
CREATE INDEX "Message_conversationId_time_idx" ON "Message"("conversationId", "time");

ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "Connection"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Message" ADD CONSTRAINT "Message_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Equipe operacional simples para roteamento e filtros da central de atendimento.
ALTER TABLE "User" ADD COLUMN "team" TEXT NOT NULL DEFAULT 'Geral';
