-- ORDEM CONSOLIDADA DO COMERCIAL — 10/09/2026
--
-- Tudo aqui é ADITIVO. Nenhuma coluna sai, nenhuma tabela sai, nenhum dado é
-- reescrito. A ordem do Diretor Geral é explícita: "Não apagar tabelas ou
-- histórico existente. Fazer migração aditiva e segura."
--
-- `IF NOT EXISTS` em toda linha porque esta migração pode alcançar um banco que
-- já recebeu parte dela por outro caminho — e migração que falha no meio deixa
-- o schema em estado que ninguém sabe nomear.

-- ── 1. OS DOIS ESTÁGIOS QUE FALTAVAM ────────────────────────────────────────
--
-- `ADD VALUE IF NOT EXISTS` é idempotente e não reescreve linha nenhuma: quem
-- está em PRIMEIRO_CONTATO continua em PRIMEIRO_CONTATO.
ALTER TYPE "SiteLeadStage" ADD VALUE IF NOT EXISTS 'DISPONIVEL_PARA_PROSPECCAO';
ALTER TYPE "SiteLeadStage" ADD VALUE IF NOT EXISTS 'RESPONDEU';

-- ── 2. A IMPORTAÇÃO COMO REGISTRO AUDITÁVEL ─────────────────────────────────
DO $$ BEGIN
  CREATE TYPE "SituacaoDaImportacao" AS ENUM ('PROCESSANDO', 'CONCLUIDA', 'FALHOU', 'CANCELADA');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "importacoes_de_leads" (
  "id"                    TEXT NOT NULL,
  "arquivoNome"           TEXT NOT NULL,
  "arquivoTipo"           TEXT,
  "arquivoHash"           TEXT,
  "arquivoBytes"          INTEGER,
  "linhasTotais"          INTEGER NOT NULL DEFAULT 0,
  "linhasAceitas"         INTEGER NOT NULL DEFAULT 0,
  "novos"                 INTEGER NOT NULL DEFAULT 0,
  "duplicadosNoArquivo"   INTEGER NOT NULL DEFAULT 0,
  "duplicadosEmOutras"    INTEGER NOT NULL DEFAULT 0,
  "jaEramLeads"           INTEGER NOT NULL DEFAULT 0,
  "telefonesInvalidos"    INTEGER NOT NULL DEFAULT 0,
  "linhasRecusadas"       INTEGER NOT NULL DEFAULT 0,
  "motivosDeRecusa"       JSONB,
  "proveniencia"          TEXT NOT NULL,
  "canalDeObtencao"       TEXT,
  "criadoPor"             TEXT,
  "criadoPorUserId"       TEXT,
  "criadoPorNome"         TEXT,
  "versaoDoMapeamento"    TEXT NOT NULL DEFAULT 'v1',
  "situacao"              "SituacaoDaImportacao" NOT NULL DEFAULT 'PROCESSANDO',
  "erroTecnico"           TEXT,
  "iniciadaEm"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "concluidaEm"           TIMESTAMP(3),
  "canceladaEm"           TIMESTAMP(3),
  "canceladaPor"          TEXT,
  "canceladaPorUserId"    TEXT,
  "motivoDoCancelamento"  TEXT,
  CONSTRAINT "importacoes_de_leads_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "importacoes_de_leads_situacao_iniciadaEm_idx"
  ON "importacoes_de_leads" ("situacao", "iniciadaEm");
CREATE INDEX IF NOT EXISTS "importacoes_de_leads_arquivoHash_idx"
  ON "importacoes_de_leads" ("arquivoHash");

ALTER TABLE "lotes_de_prospeccao" ADD COLUMN IF NOT EXISTS "importacaoId" TEXT;

DO $$ BEGIN
  ALTER TABLE "lotes_de_prospeccao"
    ADD CONSTRAINT "lotes_de_prospeccao_importacaoId_fkey"
    FOREIGN KEY ("importacaoId") REFERENCES "importacoes_de_leads"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── 3. OS MODELOS DA META, SINCRONIZADOS EM VEZ DE DIGITADOS ────────────────
CREATE TABLE IF NOT EXISTS "modelos_de_vendas" (
  "id"              TEXT NOT NULL,
  "phoneNumberId"   TEXT NOT NULL,
  "wabaId"          TEXT NOT NULL,
  "nome"            TEXT NOT NULL,
  "idioma"          TEXT NOT NULL,
  "categoria"       TEXT,
  "situacao"        TEXT NOT NULL,
  "variaveis"       INTEGER NOT NULL DEFAULT 0,
  "metaTemplateId"  TEXT,
  "motivoDaRecusa"  TEXT,
  "corpo"           TEXT,
  "sincronizadoEm"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "modelos_de_vendas_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "modelos_de_vendas_phoneNumberId_nome_idioma_key"
  ON "modelos_de_vendas" ("phoneNumberId", "nome", "idioma");
CREATE INDEX IF NOT EXISTS "modelos_de_vendas_situacao_idx"
  ON "modelos_de_vendas" ("situacao");

-- ── 4. A MEMÓRIA DA CONVERSA ────────────────────────────────────────────────
ALTER TABLE "lead_qualificacoes" ADD COLUMN IF NOT EXISTS "marketplaceAtual" TEXT;
ALTER TABLE "lead_qualificacoes" ADD COLUMN IF NOT EXISTS "objecoes" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "lead_qualificacoes" ADD COLUMN IF NOT EXISTS "funcionalidadesDeInteresse" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "lead_qualificacoes" ADD COLUMN IF NOT EXISTS "pedidoExplicito" TEXT;
ALTER TABLE "lead_qualificacoes" ADD COLUMN IF NOT EXISTS "pediuPararSondagem" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "lead_qualificacoes" ADD COLUMN IF NOT EXISTS "pediuPararSondagemEm" TIMESTAMP(3);
ALTER TABLE "lead_qualificacoes" ADD COLUMN IF NOT EXISTS "pediuHumano" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "lead_qualificacoes" ADD COLUMN IF NOT EXISTS "pediuHumanoEm" TIMESTAMP(3);
ALTER TABLE "lead_qualificacoes" ADD COLUMN IF NOT EXISTS "irritacao" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "lead_qualificacoes" ADD COLUMN IF NOT EXISTS "perguntasJaFeitas" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "lead_qualificacoes" ADD COLUMN IF NOT EXISTS "atualizadoPelaIaEm" TIMESTAMP(3);

-- ── 5. A TRILHA DO TURNO ────────────────────────────────────────────────────
ALTER TABLE "lead_mensagens" ADD COLUMN IF NOT EXISTS "turnoId" TEXT;
ALTER TABLE "lead_mensagens" ADD COLUMN IF NOT EXISTS "papelDoAgente" TEXT;
ALTER TABLE "lead_mensagens" ADD COLUMN IF NOT EXISTS "origemDaFala" TEXT;

CREATE INDEX IF NOT EXISTS "lead_mensagens_turnoId_idx" ON "lead_mensagens" ("turnoId");

-- ── 6. A TRAVA DA CONVERSA ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "travas_da_conversa" (
  "leadId"          TEXT NOT NULL,
  "donoDoTurno"     TEXT NOT NULL,
  "tomadaEm"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiraEm"        TIMESTAMP(3) NOT NULL,
  "ultimaEntradaId" TEXT,
  CONSTRAINT "travas_da_conversa_pkey" PRIMARY KEY ("leadId")
);

CREATE INDEX IF NOT EXISTS "travas_da_conversa_expiraEm_idx"
  ON "travas_da_conversa" ("expiraEm");
