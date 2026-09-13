-- ⭐ ACADEMIA COMERCIAL — conteúdo versionado de venda consultiva, consultado
-- pela Supervisora. Puramente aditiva: nenhuma tabela/coluna/enum existente é
-- tocada. Mesma doutrina de `20260912000000_supervisora_camada_de_revisao`
-- (que também é aditiva sobre a base do TA).

-- CreateEnum
CREATE TYPE "EtapaComercial" AS ENUM ('PROSPECCAO', 'QUALIFICACAO', 'DEMONSTRACAO', 'OBJECAO', 'FECHAMENTO', 'GERAL');

-- CreateEnum
CREATE TYPE "CategoriaDaAcademia" AS ENUM ('REGRA_OBRIGATORIA', 'COMPORTAMENTO_PROIBIDO', 'EXEMPLO', 'SINAL_DE_RISCO', 'CRITERIO_VEREDITO', 'ORIENTACAO_DE_ETAPA');

-- CreateTable
CREATE TABLE "academia_comercial_config" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "versaoAtivaId" TEXT,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "academia_comercial_config_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "academia_comercial_versoes" (
    "id" TEXT NOT NULL,
    "numero" INTEGER NOT NULL,
    "situacao" "SituacaoDaVersao" NOT NULL DEFAULT 'RASCUNHO',
    "notaDaVersao" TEXT,
    "publicadaEm" TIMESTAMP(3),
    "publicadaPorId" TEXT,
    "criadaEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "academia_comercial_versoes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "academia_comercial_itens" (
    "id" TEXT NOT NULL,
    "versaoId" TEXT NOT NULL,
    "categoria" "CategoriaDaAcademia" NOT NULL,
    "etapa" "EtapaComercial",
    "chaveOriginal" TEXT NOT NULL,
    "titulo" TEXT NOT NULL,
    "conteudo" TEXT NOT NULL,
    "ruim" TEXT,
    "corrigido" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "fonteUrl" TEXT,
    "fonteData" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "academia_comercial_itens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "academia_comercial_config_versaoAtivaId_key" ON "academia_comercial_config"("versaoAtivaId");

-- CreateIndex
CREATE UNIQUE INDEX "academia_comercial_versoes_numero_key" ON "academia_comercial_versoes"("numero");

-- CreateIndex
CREATE INDEX "academia_comercial_versoes_situacao_idx" ON "academia_comercial_versoes"("situacao");

-- CreateIndex
CREATE UNIQUE INDEX "academia_comercial_itens_versaoId_chaveOriginal_key" ON "academia_comercial_itens"("versaoId", "chaveOriginal");

-- CreateIndex
CREATE INDEX "academia_comercial_itens_versaoId_categoria_etapa_idx" ON "academia_comercial_itens"("versaoId", "categoria", "etapa");

-- AddForeignKey
ALTER TABLE "academia_comercial_config" ADD CONSTRAINT "academia_comercial_config_versaoAtivaId_fkey" FOREIGN KEY ("versaoAtivaId") REFERENCES "academia_comercial_versoes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "academia_comercial_versoes" ADD CONSTRAINT "academia_comercial_versoes_publicadaPorId_fkey" FOREIGN KEY ("publicadaPorId") REFERENCES "internal_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "academia_comercial_itens" ADD CONSTRAINT "academia_comercial_itens_versaoId_fkey" FOREIGN KEY ("versaoId") REFERENCES "academia_comercial_versoes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
