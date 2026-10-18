-- O estado do funil não deve depender do texto da etapa.
CREATE TYPE "StageStatus" AS ENUM ('OPEN', 'WON', 'LOST');

ALTER TABLE "Stage"
  ADD COLUMN "status" "StageStatus" NOT NULL DEFAULT 'OPEN';

-- Preserva o comportamento dos pipelines já existentes. Depois desta migração,
-- o administrador pode ajustar o status de qualquer etapa pela interface.
UPDATE "Stage"
SET "status" = 'WON'
WHERE lower(trim("label")) IN ('ganho', 'ganha', 'fechado ganho', 'fechada ganha');

UPDATE "Stage"
SET "status" = 'LOST'
WHERE lower(trim("label")) IN ('perdido', 'perdida', 'cancelado', 'cancelada', 'no-show', 'no show');
