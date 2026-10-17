CREATE TABLE "ConversationPrivateNote" (
  "id" TEXT NOT NULL,
  "text" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "organizationId" TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  "authorId" TEXT NOT NULL,
  CONSTRAINT "ConversationPrivateNote_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ConversationPrivateNote_organizationId_conversationId_authorId_createdAt_idx"
  ON "ConversationPrivateNote"("organizationId", "conversationId", "authorId", "createdAt");

ALTER TABLE "ConversationPrivateNote" ADD CONSTRAINT "ConversationPrivateNote_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ConversationPrivateNote" ADD CONSTRAINT "ConversationPrivateNote_conversationId_fkey"
  FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ConversationPrivateNote" ADD CONSTRAINT "ConversationPrivateNote_authorId_fkey"
  FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
