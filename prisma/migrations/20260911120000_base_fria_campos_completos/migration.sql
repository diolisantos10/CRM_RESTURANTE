-- Ampliação da Base fria — catorze campos novos, todos aditivos.
-- Data: 11/09/2026
--
-- Nenhuma coluna existente muda de nome, tipo ou significado. `nome`
-- (responsável), `empresa` (restaurante), `cidade`, `estado` e `tipo` (tipo de
-- restaurante) continuam exatamente como eram — só se somam os campos que a
-- prospecção B2B consultiva precisava e a base ainda não tinha.
--
-- Idempotente: `ADD COLUMN IF NOT EXISTS` não falha se rodar de novo, e não
-- apaga nem renomeia nada em linha nenhuma das 4.967 já existentes.
ALTER TABLE "itens_de_prospeccao"
  ADD COLUMN IF NOT EXISTS "email"              TEXT,
  ADD COLUMN IF NOT EXISTS "cargo"              TEXT,
  ADD COLUMN IF NOT EXISTS "telefoneSecundario" TEXT,
  ADD COLUMN IF NOT EXISTS "bairro"             TEXT,
  ADD COLUMN IF NOT EXISTS "endereco"           TEXT,
  ADD COLUMN IF NOT EXISTS "cep"                TEXT,
  ADD COLUMN IF NOT EXISTS "cnpj"               TEXT,
  ADD COLUMN IF NOT EXISTS "instagram"          TEXT,
  ADD COLUMN IF NOT EXISTS "site"               TEXT,
  ADD COLUMN IF NOT EXISTS "googleMapsUrl"      TEXT,
  ADD COLUMN IF NOT EXISTS "numeroDeUnidades"   INTEGER,
  ADD COLUMN IF NOT EXISTS "canaisAtuais"       TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS "observacoes"        TEXT,
  ADD COLUMN IF NOT EXISTS "tags"               TEXT[] NOT NULL DEFAULT '{}';
