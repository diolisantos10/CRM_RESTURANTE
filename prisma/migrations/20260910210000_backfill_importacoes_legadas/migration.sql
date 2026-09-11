-- Backfill: criar ImportacaoDeLeads para lotes órfãos (sem importacaoId)
-- Data: 10/09/2026 — corrigida em 10/09/2026 após reprovação de auditoria.
--
-- ── O DEFEITO ────────────────────────────────────────────────────────────────
-- Lotes importados antes de 10/09/2026 têm importacaoId = NULL. A tela de
-- Importações não os mostra porque não há registro na tabela importacoes_de_leads.
-- A base fica "invisível" — existe, mas não aparece organizada por arquivo.
--
-- ── A SOLUÇÃO ────────────────────────────────────────────────────────────────
-- Para cada grupo de lotes órfãos com o mesmo nome normalizado (remove
-- "(parte X/Y)") e a mesma proveniência, criar UMA ImportacaoDeLeads que
-- representa o arquivo inteiro, somando os itens de TODOS os lotes do grupo —
-- não só do primeiro, que era o defeito apontado pela auditoria — e associar
-- TODOS eles à mesma importação.
--
-- ── IDEMPOTÊNCIA, SEM DEPENDER DE `arquivoHash` ÚNICO ───────────────────────
-- `arquivoHash` só tem índice comum (`@@index`), não `@@unique` — importações
-- reais podem colidir nele, então `ON CONFLICT("arquivoHash")` é inválido e
-- quebraria a migração assim que existisse qualquer linha real com essa
-- "impressão digital" repetida por coincidência.
--
-- A chave de idempotência aqui é o `id` da PRÓPRIA importação criada, derivado
-- deterministicamente de (nome_normalizado, proveniência). Rodar a migração de
-- novo recalcula o MESMO id, e `id` é chave primária — sempre única. O segundo
-- statement (a associação) não depende do INSERT ter inserido algo: ele lê o
-- lote sempre que `importacaoId IS NULL`, então uma segunda rodada não faz nada
-- em nenhum dos dois statements, e uma terceira rodada com lotes novos que
-- caem no mesmo grupo ainda converge para a importação já existente.

-- ── Statement 1: uma ImportacaoDeLeads por grupo, somando TODOS os lotes ────
WITH lotes_orfaos AS (
  SELECT
    l.id AS lote_id,
    l.proveniencia,
    l."criadoEm",
    REGEXP_REPLACE(l.nome, '\s*\(parte\s+\d+/\d+\)\s*$', '') AS nome_normalizado
  FROM "lotes_de_prospeccao" l
  WHERE l."importacaoId" IS NULL
),
itens_por_lote AS (
  SELECT
    lo.lote_id,
    lo.proveniencia,
    lo.nome_normalizado,
    lo."criadoEm",
    COUNT(i.id) AS itens_no_lote
  FROM lotes_orfaos lo
  LEFT JOIN "itens_de_prospeccao" i ON i."loteId" = lo.lote_id
  GROUP BY lo.lote_id, lo.proveniencia, lo.nome_normalizado, lo."criadoEm"
),
grupos AS (
  SELECT
    nome_normalizado,
    proveniencia,
    'bkf_' || MD5(nome_normalizado || '::' || proveniencia) AS importacao_id,
    MD5(nome_normalizado || '::' || proveniencia) AS impressao_digital,
    MIN("criadoEm") AS data_mais_antiga,
    -- Soma de TODAS as partes do grupo — o defeito relatado pela auditoria era
    -- exatamente contar só a primeira. bigint -> int: a base não chega perto
    -- do teto de 32 bits, e o valor original já era Int no schema.
    SUM(itens_no_lote)::int AS total_itens
  FROM itens_por_lote
  GROUP BY nome_normalizado, proveniencia
)
INSERT INTO "importacoes_de_leads" (
  "id", "arquivoNome", "arquivoHash", "linhasTotais", "linhasAceitas",
  "novos", "duplicadosNoArquivo", "duplicadosEmOutras", "jaEramLeads",
  "telefonesInvalidos", "linhasRecusadas", "proveniencia", "canalDeObtencao",
  "criadoPor", "criadoPorUserId", "criadoPorNome", "versaoDoMapeamento",
  "situacao", "iniciadaEm", "concluidaEm"
)
SELECT
  g.importacao_id,
  g.nome_normalizado,
  g.impressao_digital,
  g.total_itens,
  g.total_itens,
  0, 0, 0, 0, 0, 0,
  g.proveniencia,
  NULL,
  'sistema-backfill', NULL, 'sistema-backfill',
  'v1',
  'CONCLUIDA'::"SituacaoDaImportacao",
  g.data_mais_antiga,
  NOW()
FROM grupos g
ON CONFLICT ("id") DO NOTHING;

-- ── Statement 2: associar TODO lote ainda órfão do grupo — sempre roda ─────
-- Não depende de RETURNING do statement 1: recalcula o mesmo id determinístico
-- inline. Por isso pega tanto o lote que acabou de ganhar a importação nova
-- quanto qualquer lote do MESMO grupo que só apareceu depois — e ignora sem
-- erro o lote que já tinha sido associado numa rodada anterior, porque esse
-- já não casa o filtro `IS NULL`.
UPDATE "lotes_de_prospeccao" l
SET "importacaoId" = 'bkf_' || MD5(
  REGEXP_REPLACE(l.nome, '\s*\(parte\s+\d+/\d+\)\s*$', '') || '::' || l.proveniencia
)
WHERE l."importacaoId" IS NULL;
