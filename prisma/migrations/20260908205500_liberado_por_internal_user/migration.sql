-- ─────────────────────────────────────────────────────────────────────────────
-- O PREENCHIMENTO RETROATIVO CONTRA A TABELA CERTA.
--
-- A migração de 20h30 de hoje casou o id do rótulo contra `users`. **A chave
-- estrangeira de `lead_mensagens.autorUserId` aponta para `internal_users`** —
-- `LeadMensagem.autorUser` é uma relação com `InternalUser`, e a gente da Sala
-- de Vendas vive lá, não em `users`.
--
-- Medido, e não deduzido: com o diagnóstico do #223 no ar, a rodada mostrou
--
--   rotuloLiberadoPor: 'Diego (cmt9i0lfe00kw143x1m3o1zmn)'
--   liberadoPorUserId: null
--
-- O rótulo estava no formato certo. O que não casou foi a tabela: aquele id é
-- de `internal_users`, e o JOIN procurava em `users`.
--
-- ⚠️ A regra que fica: chave estrangeira se LÊ no schema antes de escrever o
-- JOIN. Eu escrevi "chave estrangeira para `users`" num comentário, sem medir,
-- e o comentário virou a fonte do meu próprio erro na migração seguinte.
-- ─────────────────────────────────────────────────────────────────────────────

UPDATE "lotes_de_prospeccao" AS l
SET "liberadoPorUserId" = sub.id
FROM (
  SELECT
    lp.id AS lote_id,
    iu.id AS id
  FROM "lotes_de_prospeccao" lp
  JOIN "internal_users" iu
    ON iu.id = substring(lp."liberadoPor" from '\(([^()]*)\)[^()]*$')
  WHERE lp."liberadoPor" IS NOT NULL
) AS sub
WHERE l.id = sub.lote_id
  AND l."liberadoPorUserId" IS NULL;
