-- ═══════════════════════════════════════════════════════════════════════════
-- ⛔ ROLLBACK EM PRODUÇÃO — passo a passo, se um dia for preciso desfazer
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Escrito em 12/09/2026, item 7 da auditoria do CEO sobre esta feature.
-- Nenhum passo abaixo foi um DOWN automático do Prisma (esta cadeia de
-- migrations não usa `migrate down`) — são comandos para rodar À MÃO, na
-- ordem, com alguém olhando cada resultado antes do próximo.
--
-- ── ANTES DE QUALQUER DROP ───────────────────────────────────────────────────
--
--   0a. Confirmar que `SupervisoraConfig.modoEfetivo` está OFF (ou que ninguém
--       se importa em perder a Supervisora rodando) — GUARD/INTERVENTION ativos
--       significa que mensagens estão sendo bloqueadas/reescritas por ela AGORA;
--       desligar o código sem desligar o comportamento primeiro (`POST
--       /api/admin/sala-de-vendas/supervisora` com `{ligada: false}`) muda o
--       comportamento de produção no mesmo instante do rollback, sem aviso.
--   0b. Guardar uma cópia das quatro tabelas novas antes de dropar — elas são
--       histórico de auditoria (avaliações, sugestões, trocas de modo), não
--       cache: uma vez dropadas, esse histórico não volta.
--         pg_dump --table=supervisora_avaliacoes --table=supervisora_config \
--                 --table=supervisora_modo_historico \
--                 --table=supervisora_sugestoes_prompt \
--                 --data-only -Fc "$DATABASE_URL" > supervisora_backup.dump
--
-- ── A ORDEM DOS DROPS (de quem depende para quem é dependido) ───────────────
--
--   1. `supervisora_sugestoes_prompt` — não tem FK de ninguém apontando pra
--      ela (só referências textuais soltas, `evidenciaMensagemIds`/
--      `evidenciaLeadIds`, sem constraint). Primeira a cair.
--        DROP TABLE IF EXISTS "supervisora_sugestoes_prompt";
--
--   2. `supervisora_avaliacoes` — tem FK para `lead_mensagens` e `SiteLead`
--      (ON DELETE CASCADE nesse sentido, mas a tabela em si não é referenciada
--      por mais ninguém). Segunda a cair.
--        DROP TABLE IF EXISTS "supervisora_avaliacoes";
--
--   3. `supervisora_modo_historico` — tem FK para `supervisora_config`.
--      Precisa cair ANTES da config, senão a FK barra o DROP seguinte.
--        DROP TABLE IF EXISTS "supervisora_modo_historico";
--
--   4. `supervisora_config` — por último entre as quatro, já sem nada mais
--      apontando pra ela.
--        DROP TABLE IF EXISTS "supervisora_config";
--
--   5. As colunas que esta migração ACRESCENTOU em `sdr_ia_config_versoes`
--      (todas opcionais — remover não quebra nenhuma linha existente, mas
--      apaga o que estiver preenchido nelas, ex.: sugestões de nível 3 já
--      aprovadas). Conferir com quem pediu o rollback se isso é aceitável
--      antes de rodar:
--        ALTER TABLE "sdr_ia_config_versoes"
--          DROP COLUMN IF EXISTS "agenteAfetado",
--          DROP COLUMN IF EXISTS "criadaPorId",
--          DROP COLUMN IF EXISTS "evidencias",
--          DROP COLUMN IF EXISTS "justificativaDaAlteracao",
--          DROP COLUMN IF EXISTS "origemSugestaoId",
--          DROP COLUMN IF EXISTS "problemaObservado",
--          DROP COLUMN IF EXISTS "testeCorrespondente",
--          DROP COLUMN IF EXISTS "trechoAnterior",
--          DROP COLUMN IF EXISTS "trechoNovoProposto";
--
--   6. Os enums — só depois de nada mais usá-los (os DROPs 1-5 já bastam,
--      porque nenhuma outra tabela deste schema usa estes tipos):
--        DROP TYPE IF EXISTS "ModoDaSupervisora";
--        DROP TYPE IF EXISTS "CamadaDaSupervisora";
--        DROP TYPE IF EXISTS "VeredictoDaSupervisora";
--        DROP TYPE IF EXISTS "AcaoDaSupervisora";
--        DROP TYPE IF EXISTS "MotivoDaSupervisora";
--        DROP TYPE IF EXISTS "AutorDaSugestaoDePrompt";
--        DROP TYPE IF EXISTS "SituacaoDaSugestaoDePrompt";
--
-- ── DEPOIS DO BANCO ───────────────────────────────────────────────────────────
--
--   7. O rollback do BANCO não desfaz o CÓDIGO: `entrega.ts` continua chamando
--      `revisarAntesDeEntregar`, que continua lendo `supervisora_config` — sem
--      a tabela, `lerConfig` lança, e (para SHADOW) isso é tratado como "não
--      espera, dispara em segundo plano" (ver `revisao.ts`), o que por sua vez
--      tentaria gravar em `supervisora_avaliacoes`, que também não existe mais.
--      Rollback de banco sem reverter (ou pelo menos desligar) o deploy do
--      código deixa todo turno da IA gerando um erro de "tabela não existe" em
--      segundo plano — silenciado do ponto de vista do envio (SHADOW nunca
--      bloqueia), mas barulhento no log. Reverta os dois juntos.
--
-- ═══════════════════════════════════════════════════════════════════════════

-- CreateEnum
CREATE TYPE "ModoDaSupervisora" AS ENUM ('OFF', 'SHADOW', 'GUARD', 'INTERVENTION');

-- CreateEnum
CREATE TYPE "CamadaDaSupervisora" AS ENUM ('RAPIDA', 'PROFUNDA');

-- CreateEnum
CREATE TYPE "VeredictoDaSupervisora" AS ENUM ('VERDE', 'AMARELO', 'VERMELHO', 'CRITICO');

-- CreateEnum
CREATE TYPE "AcaoDaSupervisora" AS ENUM ('NENHUMA', 'REESCREVEU', 'BLOQUEOU', 'BLOQUEOU_E_ESCALOU');

-- CreateEnum
CREATE TYPE "MotivoDaSupervisora" AS ENUM ('MENSAGEM_INVASIVA', 'INSISTENCIA_APOS_RECUSA', 'PITCH_ERRADO', 'TOM_ROBOTICO', 'PROMESSA_INCORRETA', 'PERSONALIZACAO_FRACA', 'PRESSAO_COMERCIAL', 'INTERROGATORIO', 'SEQUENCIA_DE_MENSAGENS', 'TIMING_RUIM', 'FALHA_TECNICA', 'OUTRO');

-- CreateEnum
CREATE TYPE "AutorDaSugestaoDePrompt" AS ENUM ('SISTEMA', 'SUPERVISORA');

-- CreateEnum
CREATE TYPE "SituacaoDaSugestaoDePrompt" AS ENUM ('PENDENTE', 'APROVADA', 'REJEITADA', 'APLICADA');

-- ⚠️ NADA AQUI TOCA `conflitos_de_importacao` NEM `modelos_de_vendas`.
--
-- `prisma migrate diff` contra o banco de dev real trouxe também um DROP de
-- `conflitos_de_importacao` (tabela) e da coluna `modelos_de_vendas.autorizado`
-- — drift PRÉ-EXISTENTE, sem relação com a Supervisora: o schema.prisma desta
-- branch já não declara esse model/coluna, mas nenhuma migração anterior os
-- removeu. Incluir esse drop aqui misturaria uma limpeza não pedida dentro de
-- uma migração de feature — e um DROP TABLE é o tipo de coisa que não se
-- corrige por atalho. Deixado de fora de propósito; quem cuidar dessa dívida
-- faz uma migração própria para ela, só com ela.

-- AlterTable
ALTER TABLE "sdr_ia_config_versoes" ADD COLUMN     "agenteAfetado" TEXT,
ADD COLUMN     "criadaPorId" TEXT,
ADD COLUMN     "evidencias" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "justificativaDaAlteracao" TEXT,
ADD COLUMN     "origemSugestaoId" TEXT,
ADD COLUMN     "problemaObservado" TEXT,
ADD COLUMN     "testeCorrespondente" TEXT,
ADD COLUMN     "trechoAnterior" TEXT,
ADD COLUMN     "trechoNovoProposto" TEXT;

-- CreateTable
CREATE TABLE "supervisora_config" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "ligada" BOOLEAN NOT NULL DEFAULT true,
    "modo" "ModoDaSupervisora" NOT NULL DEFAULT 'SHADOW',
    "atualizadoPor" TEXT,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "supervisora_config_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supervisora_modo_historico" (
    "id" TEXT NOT NULL,
    "configId" TEXT NOT NULL DEFAULT 'singleton',
    "modoAnterior" "ModoDaSupervisora" NOT NULL,
    "modoNovo" "ModoDaSupervisora" NOT NULL,
    "alteradoPor" TEXT NOT NULL,
    "motivo" TEXT,
    "alteradoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "supervisora_modo_historico_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supervisora_avaliacoes" (
    "id" TEXT NOT NULL,
    "mensagemId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "autorMensagem" "AutorDaMensagem",
    "autorUserId" TEXT,
    "papelDoAgente" TEXT,
    "camada" "CamadaDaSupervisora" NOT NULL,
    "modoNaEpoca" "ModoDaSupervisora" NOT NULL,
    "veredito" "VeredictoDaSupervisora" NOT NULL,
    "motivos" "MotivoDaSupervisora"[] DEFAULT ARRAY[]::"MotivoDaSupervisora"[],
    "motivoDetalhe" TEXT,
    "textoOriginal" TEXT,
    "textoReescrito" TEXT,
    "bloqueada" BOOLEAN NOT NULL DEFAULT false,
    "acaoTomada" "AcaoDaSupervisora" NOT NULL DEFAULT 'NENHUMA',
    "handoffDisparado" BOOLEAN NOT NULL DEFAULT false,
    "falhaTecnica" BOOLEAN NOT NULL DEFAULT false,
    "engineProvider" TEXT,
    "engineModel" TEXT,
    "criadaEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "supervisora_avaliacoes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supervisora_sugestoes_prompt" (
    "id" TEXT NOT NULL,
    "agenteAfetadoTipo" "AutorDaMensagem",
    "agenteAfetadoUserId" TEXT,
    "papelDoAgente" TEXT,
    "problemaObservado" TEXT NOT NULL,
    "evidenciaMensagemIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "evidenciaLeadIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "trechoAnterior" TEXT,
    "trechoNovoProposto" TEXT,
    "justificativa" TEXT NOT NULL,
    "autor" "AutorDaSugestaoDePrompt" NOT NULL DEFAULT 'SUPERVISORA',
    "situacao" "SituacaoDaSugestaoDePrompt" NOT NULL DEFAULT 'PENDENTE',
    "revisadaPorId" TEXT,
    "revisadaEm" TIMESTAMP(3),
    "notaDaRevisao" TEXT,
    "versaoResultanteId" TEXT,
    "criadaEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "supervisora_sugestoes_prompt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "supervisora_modo_historico_configId_alteradoEm_idx" ON "supervisora_modo_historico"("configId", "alteradoEm");

-- CreateIndex
CREATE UNIQUE INDEX "supervisora_avaliacoes_mensagemId_key" ON "supervisora_avaliacoes"("mensagemId");

-- CreateIndex
CREATE INDEX "supervisora_avaliacoes_leadId_criadaEm_idx" ON "supervisora_avaliacoes"("leadId", "criadaEm");

-- CreateIndex
CREATE INDEX "supervisora_avaliacoes_autorUserId_criadaEm_idx" ON "supervisora_avaliacoes"("autorUserId", "criadaEm");

-- CreateIndex
CREATE INDEX "supervisora_avaliacoes_papelDoAgente_criadaEm_idx" ON "supervisora_avaliacoes"("papelDoAgente", "criadaEm");

-- CreateIndex
CREATE INDEX "supervisora_avaliacoes_veredito_criadaEm_idx" ON "supervisora_avaliacoes"("veredito", "criadaEm");

-- CreateIndex
CREATE INDEX "supervisora_avaliacoes_bloqueada_idx" ON "supervisora_avaliacoes"("bloqueada");

-- CreateIndex
CREATE INDEX "supervisora_sugestoes_prompt_situacao_criadaEm_idx" ON "supervisora_sugestoes_prompt"("situacao", "criadaEm");

-- CreateIndex
CREATE INDEX "supervisora_sugestoes_prompt_agenteAfetadoUserId_idx" ON "supervisora_sugestoes_prompt"("agenteAfetadoUserId");

-- CreateIndex
CREATE INDEX "sdr_ia_config_versoes_origemSugestaoId_idx" ON "sdr_ia_config_versoes"("origemSugestaoId");

-- AddForeignKey
ALTER TABLE "supervisora_modo_historico" ADD CONSTRAINT "supervisora_modo_historico_configId_fkey" FOREIGN KEY ("configId") REFERENCES "supervisora_config"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supervisora_avaliacoes" ADD CONSTRAINT "supervisora_avaliacoes_mensagemId_fkey" FOREIGN KEY ("mensagemId") REFERENCES "lead_mensagens"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supervisora_avaliacoes" ADD CONSTRAINT "supervisora_avaliacoes_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "SiteLead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

