-- Quadro de tarefas (estilo Trello). Aditivo: tarefas existentes ficam sem
-- coluna (listId nulo) e aparecem na primeira coluna do mesmo tipo.
CREATE TABLE "TaskList" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "isDone" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "organizationId" TEXT NOT NULL,

    CONSTRAINT "TaskList_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TaskList_organizationId_idx" ON "TaskList"("organizationId");

ALTER TABLE "TaskList" ADD CONSTRAINT "TaskList_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Activity" ADD COLUMN "listId" TEXT;
ALTER TABLE "Activity" ADD COLUMN "position" INTEGER NOT NULL DEFAULT 0;

CREATE INDEX "Activity_listId_idx" ON "Activity"("listId");

ALTER TABLE "Activity" ADD CONSTRAINT "Activity_listId_fkey"
  FOREIGN KEY ("listId") REFERENCES "TaskList"("id") ON DELETE SET NULL ON UPDATE CASCADE;
