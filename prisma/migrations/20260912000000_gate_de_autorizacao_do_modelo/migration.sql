-- ─────────────────────────────────────────────────────────────────────────────
-- O GATE DE AUTORIZAÇÃO DO MODELO — separado do `situacao` que a Meta atribui.
--
-- ⚠️ CUIDADO CRÍTICO — MEDIDO ANTES DE ESCREVER ESTA MIGRAÇÃO ─────────────────
--
-- `abordagem_restaurante_fria` está `situacao = 'APPROVED'` e mandando
-- mensagem real em produção HOJE (corrigido no #245). `ADD COLUMN ... DEFAULT
-- true` já cobre esse caso para toda linha existente — mas o UPDATE abaixo
-- fica explícito mesmo assim, e não por redundância decorativa: se um dia
-- alguém trocar o padrão da coluna sem reler este comentário, o UPDATE ainda
-- garante que nenhum modelo `APPROVED` já gravado sai desautorizado por
-- engano. Modelo novo, sincronizado DEPOIS desta migração, nasce com o
-- `@default(true)` do schema — a trava explícita de "v1 em revisão" é ato
-- deliberado sobre um modelo específico (`autorizado = false` marcado à mão),
-- nunca o padrão de quem acaba de ser aprovado pela Meta.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE "modelos_de_vendas" ADD COLUMN IF NOT EXISTS "autorizado" BOOLEAN NOT NULL DEFAULT true;

-- Redundante com o DEFAULT acima para quem já está no banco — deixado
-- explícito de propósito, ver o comentário grande acima.
UPDATE "modelos_de_vendas"
SET "autorizado" = true
WHERE "situacao" = 'APPROVED' AND "autorizado" IS DISTINCT FROM true;

-- ─────────────────────────────────────────────────────────────────────────────
-- O CONFLITO DE IMPORTAÇÃO — auditoria de campo já preenchido divergindo de
-- um valor novo trazido por planilha. Ver o comentário grande em
-- `ConflitoDeImportacao`, no schema.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "conflitos_de_importacao" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "campo" TEXT NOT NULL,
    "valorAtual" TEXT NOT NULL,
    "valorNovo" TEXT NOT NULL,
    "arquivoOrigem" TEXT,
    "detectadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conflitos_de_importacao_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "conflitos_de_importacao_itemId_idx" ON "conflitos_de_importacao"("itemId");
CREATE INDEX IF NOT EXISTS "conflitos_de_importacao_campo_idx" ON "conflitos_de_importacao"("campo");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'conflitos_de_importacao_itemId_fkey'
  ) THEN
    ALTER TABLE "conflitos_de_importacao"
      ADD CONSTRAINT "conflitos_de_importacao_itemId_fkey"
      FOREIGN KEY ("itemId") REFERENCES "itens_de_prospeccao"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
