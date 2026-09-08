-- ─────────────────────────────────────────────────────────────────────────────
-- QUEM LIBEROU O LOTE, COMO ID — e não como rótulo de tela.
--
-- O DEFEITO, medido em produção em 08/09/2026: `liberadoPor` guarda
-- `Nome (userId)` — uma string montada para aparecer na tela como
-- "Liberado por Fulano (cxyz…)". A rodada automática entregava essa string
-- inteira a `lead_mensagens.autorUserId`, que tem chave estrangeira para
-- `users`. A primeira rodada real em que o portão liberou morreu com
-- `Foreign key constraint violated`, HTTP 500, e derrubou os outros nove
-- contatos junto.
--
-- A COLUNA NOVA guarda o id. O preenchimento retroativo extrai o que está
-- entre os ÚLTIMOS parênteses do rótulo — e só aceita se esse valor existir
-- de fato em `users`. Id que não casa fica NULL, e lote sem responsável não
-- é abordado: é a mesma regra de antes, agora aplicada a um dado verdadeiro.
-- Preencher "de ofício" faria a auditoria apontar para alguém que nunca
-- autorizou nada.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE "lotes_de_prospeccao" ADD COLUMN IF NOT EXISTS "liberadoPorUserId" TEXT;

UPDATE "lotes_de_prospeccao" AS l
SET "liberadoPorUserId" = sub.id
FROM (
  SELECT
    lp.id AS lote_id,
    u.id  AS id
  FROM "lotes_de_prospeccao" lp
  JOIN "users" u
    ON u.id = substring(lp."liberadoPor" from '\(([^()]*)\)[^()]*$')
  WHERE lp."liberadoPor" IS NOT NULL
) AS sub
WHERE l.id = sub.lote_id
  AND l."liberadoPorUserId" IS NULL;
