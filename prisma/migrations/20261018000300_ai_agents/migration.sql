-- Agente de IA (chatbot) para as automações. Aditivo.
ALTER TABLE "Conversation" ADD COLUMN "aiPausedAt" TIMESTAMP(3);

CREATE TABLE "AiAgent" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "model" TEXT NOT NULL DEFAULT 'claude-opus-5-5',
    "effort" TEXT NOT NULL DEFAULT 'medium',
    "systemPrompt" TEXT NOT NULL DEFAULT '',
    "apiKey" TEXT NOT NULL,
    "apiKeyHint" TEXT NOT NULL DEFAULT '',
    "tools" TEXT NOT NULL DEFAULT '[]',
    "maxToolSteps" INTEGER NOT NULL DEFAULT 6,
    "historyLimit" INTEGER NOT NULL DEFAULT 20,
    "replyLimitPerHour" INTEGER NOT NULL DEFAULT 20,
    "dailyTokenLimit" INTEGER NOT NULL DEFAULT 0,
    "handoffMessage" TEXT NOT NULL DEFAULT 'Vou chamar um atendente para continuar com você. Já já alguém responde por aqui.',
    "lastError" TEXT,
    "lastErrorAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "organizationId" TEXT NOT NULL,

    CONSTRAINT "AiAgent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AiUsage" (
    "id" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "steps" INTEGER NOT NULL DEFAULT 0,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "cacheReadTokens" INTEGER NOT NULL DEFAULT 0,
    "detail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "organizationId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "contactId" TEXT,

    CONSTRAINT "AiUsage_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AiAgent_organizationId_idx" ON "AiAgent"("organizationId");
CREATE INDEX "AiUsage_organizationId_createdAt_idx" ON "AiUsage"("organizationId", "createdAt");
CREATE INDEX "AiUsage_agentId_createdAt_idx" ON "AiUsage"("agentId", "createdAt");
CREATE INDEX "AiUsage_contactId_createdAt_idx" ON "AiUsage"("contactId", "createdAt");

ALTER TABLE "AiAgent" ADD CONSTRAINT "AiAgent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AiUsage" ADD CONSTRAINT "AiUsage_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "AiAgent"("id") ON DELETE CASCADE ON UPDATE CASCADE;