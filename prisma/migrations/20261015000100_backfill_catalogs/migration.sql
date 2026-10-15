-- Preenche os campos novos a partir dos dados que já existem. Idempotente:
-- só mexe no que ainda está vazio, então pode rodar de novo sem efeito.

-- 1) Resumo da última mensagem de cada contato (usado pela lista de conversas).
UPDATE "Contact" c
SET "lastMessageAt" = lm.time,
    "lastMessageText" = left(lm.text, 200),
    "lastMessageDirection" = lm.direction
FROM (
  SELECT DISTINCT ON ("contactId") "contactId", time, text, direction
  FROM "Message"
  ORDER BY "contactId", time DESC, id DESC
) lm
WHERE c.id = lm."contactId" AND c."lastMessageAt" IS NULL;

-- 2) Catálogo de motivos de perda: cria a partir do texto livre já usado nos
--    negócios e liga cada negócio ao motivo correspondente.
INSERT INTO "LossReason" (id, name, "organizationId")
SELECT 'lr_' || replace(gen_random_uuid()::text, '-', ''), t.name, t."organizationId"
FROM (
  SELECT DISTINCT "organizationId", btrim("lossReason") AS name
  FROM "Opportunity"
  WHERE "lossReason" IS NOT NULL AND btrim("lossReason") <> ''
) t
ON CONFLICT ("organizationId", name) DO NOTHING;

UPDATE "Opportunity" o
SET "lossReasonId" = lr.id
FROM "LossReason" lr
WHERE o."lossReasonId" IS NULL
  AND o."lossReason" IS NOT NULL
  AND lr."organizationId" = o."organizationId"
  AND lr.name = btrim(o."lossReason");
