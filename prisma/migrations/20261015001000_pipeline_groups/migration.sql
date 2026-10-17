-- Agrupamento de pipelines (ex.: "Pré-venda", "Venda"). Aditivo.
ALTER TABLE "Pipeline" ADD COLUMN "groupName" TEXT NOT NULL DEFAULT 'Geral';
