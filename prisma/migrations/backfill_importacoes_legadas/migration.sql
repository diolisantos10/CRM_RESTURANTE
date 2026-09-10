-- Backfill: criar ImportacaoDeLeads para lotes órfãos (sem importacaoId)
-- Data: 10/09/2026
--
-- ── O DEFEITO ────────────────────────────────────────────────────────────────
-- Lotes importados antes de 10/09/2026 têm importacaoId = NULL. A tela de
-- Importações não os mostra porque não há registro na tabela importacoes_de_leads.
-- A base fica "invisível" — existe, mas não aparece organizada por arquivo.
--
-- ── A SOLUÇÃO ────────────────────────────────────────────────────────────────
-- Para cada lote órfão, criar um ImportacaoDeLeads que o representa:
-- 1. Agrupar por nome normalizado (remove "(parte X/Y)" se houver)
-- 2. Criar UMA importação por grupo
-- 3. Contar o total de itens e associar ao lote
-- 4. Registrar como CONCLUIDA (não está entrando, já está pronta)
-- 5. Idempotente: não duplica se rodada de novo

-- Passo 1: Preparar dados dos lotes órfãos com contagem de itens
WITH lotes_orfaos AS (
  SELECT
    l.id AS lote_id,
    l.nome AS lote_nome,
    l.proveniencia,
    REGEXP_REPLACE(l.nome, '\s*\(parte\s+\d+/\d+\)\s*$', '') AS nome_normalizado,
    COUNT(i.id) AS total_itens,
    MIN(l."criadoEm") AS data_mais_antiga
  FROM "lotes_de_prospeccao" l
  LEFT JOIN "itens_de_prospeccao" i ON i."loteId" = l.id
  WHERE l."importacaoId" IS NULL
  GROUP BY l.id, l.nome, l.proveniencia
),

-- Passo 2: Deduplica importações por nome normalizado (pega primeira de cada grupo)
importacoes_a_criar AS (
  SELECT DISTINCT ON (nome_normalizado)
    nome_normalizado,
    proveniencia,
    data_mais_antiga,
    total_itens,
    lote_id
  FROM lotes_orfaos
  ORDER BY nome_normalizado, data_mais_antiga
),

-- Passo 3: Inserir ImportacaoDeLeads (idempotente via arquivoHash único)
inserted AS (
  INSERT INTO "importacoes_de_leads" (
    "id", "arquivoNome", "arquivoHash", "linhasTotais", "linhasAceitas",
    "novos", "duplicadosNoArquivo", "duplicadosEmOutras", "jaEramLeads",
    "telefonesInvalidos", "linhasRecusadas", "proveniencia", "canalDeObtencao",
    "criadoPor", "criadoPorUserId", "criadoPorNome", "versaoDoMapeamento",
    "situacao", "criadoEm", "concluidoEm"
  )
  SELECT
    gen_random_uuid(),
    ic.nome_normalizado,
    encode(digest(ic.nome_normalizado || '::' || COALESCE(ic.proveniencia, 'legado'), 'sha256'), 'hex'),
    COALESCE(ic.total_itens, 0),
    COALESCE(ic.total_itens, 0),
    0, 0, 0, 0, 0, 0,
    COALESCE(ic.proveniencia, 'legado-backfill'),
    NULL,
    'sistema-backfill', NULL, 'sistema-backfill',
    'v1',
    'CONCLUIDA'::text,
    ic.data_mais_antiga,
    NOW()
  FROM importacoes_a_criar ic
  ON CONFLICT("arquivoHash") DO NOTHING
  RETURNING id, "arquivoHash"
)

-- Passo 4: Associar lotes a suas novas importações
UPDATE "lotes_de_prospeccao" l
SET "importacaoId" = i.id
FROM importacoes_a_criar ic
JOIN "importacoes_de_leads" i
  ON i."arquivoHash" = encode(digest(ic.nome_normalizado || '::' || COALESCE(ic.proveniencia, 'legado'), 'sha256'), 'hex')
WHERE l.id = ic.lote_id
  AND l."importacaoId" IS NULL;
