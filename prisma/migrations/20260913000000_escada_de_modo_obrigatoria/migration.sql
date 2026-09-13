-- ─────────────────────────────────────────────────────────────────────────────
-- ESCADA DE MODO OBRIGATÓRIA — registra também a tentativa recusada.
--
-- `alterarModo` (config.ts) aceitava qualquer transição entre OFF/SHADOW/
-- GUARD/INTERVENTION, inclusive um salto de 2+ degraus sem nunca passar por
-- SHADOW. A trava agora vive no código; esta migração só abre espaço para a
-- auditoria: `aceita` marca se a linha do histórico é uma troca de verdade
-- (`true`, o comportamento de sempre) ou uma tentativa que a escada barrou
-- (`false`). Aditiva e pequena, separada da migração original da Supervisora
-- — nada aqui toca a migração já aplicada.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE "supervisora_modo_historico" ADD COLUMN IF NOT EXISTS "aceita" BOOLEAN NOT NULL DEFAULT true;
