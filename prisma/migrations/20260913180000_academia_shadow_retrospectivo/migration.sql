-- ⭐ SHADOW RETROSPECTIVO — tabela pequena, só de leitura/consulta, para o
-- resultado de `scripts/shadow-retrospectivo.ts` reavaliando mensagens de
-- SAÍDA já enviadas. Puramente aditiva: nenhuma tabela/coluna/enum existente
-- é tocada, reaproveita os enums já existentes da Supervisora
-- (CamadaDaSupervisora, VeredictoDaSupervisora, MotivoDaSupervisora).

-- CreateTable
CREATE TABLE "academia_revisoes_retrospectivas" (
    "id" TEXT NOT NULL,
    "mensagemId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "ocorreuEmOriginal" TIMESTAMP(3) NOT NULL,
    "camada" "CamadaDaSupervisora" NOT NULL,
    "veredito" "VeredictoDaSupervisora" NOT NULL,
    "motivos" "MotivoDaSupervisora"[] DEFAULT ARRAY[]::"MotivoDaSupervisora"[],
    "motivoDetalhe" TEXT,
    "falhaTecnica" BOOLEAN NOT NULL DEFAULT false,
    "engineProvider" TEXT,
    "engineModel" TEXT,
    "loteId" TEXT,
    "revisadaEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "academia_revisoes_retrospectivas_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "academia_revisoes_retrospectivas_mensagemId_key" ON "academia_revisoes_retrospectivas"("mensagemId");

-- CreateIndex
CREATE INDEX "academia_revisoes_retrospectivas_leadId_ocorreuEmOriginal_idx" ON "academia_revisoes_retrospectivas"("leadId", "ocorreuEmOriginal");

-- CreateIndex
CREATE INDEX "academia_revisoes_retrospectivas_veredito_revisadaEm_idx" ON "academia_revisoes_retrospectivas"("veredito", "revisadaEm");

-- CreateIndex
CREATE INDEX "academia_revisoes_retrospectivas_loteId_idx" ON "academia_revisoes_retrospectivas"("loteId");

-- AddForeignKey
ALTER TABLE "academia_revisoes_retrospectivas" ADD CONSTRAINT "academia_revisoes_retrospectivas_mensagemId_fkey" FOREIGN KEY ("mensagemId") REFERENCES "lead_mensagens"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "academia_revisoes_retrospectivas" ADD CONSTRAINT "academia_revisoes_retrospectivas_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "SiteLead"("id") ON DELETE CASCADE ON UPDATE CASCADE;
