ALTER TABLE "User" ADD COLUMN "accessConfigured" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "UserPipelineAccess" (
    "id" TEXT NOT NULL,
    "canView" BOOLEAN NOT NULL DEFAULT true,
    "canEdit" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT NOT NULL,
    "pipelineId" TEXT NOT NULL,
    CONSTRAINT "UserPipelineAccess_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "UserConnectionAccess" (
    "id" TEXT NOT NULL,
    "canView" BOOLEAN NOT NULL DEFAULT true,
    "canSend" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    CONSTRAINT "UserConnectionAccess_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "UserPipelineAccess_userId_pipelineId_key" ON "UserPipelineAccess"("userId", "pipelineId");
CREATE INDEX "UserPipelineAccess_pipelineId_idx" ON "UserPipelineAccess"("pipelineId");
CREATE UNIQUE INDEX "UserConnectionAccess_userId_connectionId_key" ON "UserConnectionAccess"("userId", "connectionId");
CREATE INDEX "UserConnectionAccess_connectionId_idx" ON "UserConnectionAccess"("connectionId");

ALTER TABLE "UserPipelineAccess" ADD CONSTRAINT "UserPipelineAccess_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserPipelineAccess" ADD CONSTRAINT "UserPipelineAccess_pipelineId_fkey" FOREIGN KEY ("pipelineId") REFERENCES "Pipeline"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserConnectionAccess" ADD CONSTRAINT "UserConnectionAccess_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserConnectionAccess" ADD CONSTRAINT "UserConnectionAccess_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "Connection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
