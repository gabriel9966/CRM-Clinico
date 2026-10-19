-- Escopo de dados por usuário ("só os meus" / "da equipe" / "todos"). Aditivo.
ALTER TABLE "User" ADD COLUMN "dataScope" TEXT NOT NULL DEFAULT 'own';
ALTER TABLE "User" ADD COLUMN "seeUnassigned" BOOLEAN NOT NULL DEFAULT true;

-- Preserva o que cada um já via: administradores e quem gerenciava todas as
-- conversas continuam vendo tudo; os demais passam a ver só a própria carteira.
UPDATE "User" SET "dataScope" = 'all'
WHERE "role" = 'ADMIN' OR "permissions" LIKE '%"conversations.manage"%';