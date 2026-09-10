-- O WABA da Sala Comercial deixa de depender de alguém copiar do log.
--
-- Aditiva e nulável: nenhuma linha existente muda, nenhum dado é perdido, e o
-- código continua caindo em FOOCCI_SALES_WABA_ID enquanto estas colunas
-- estiverem vazias. Ver `contaDoNumeroDeVendas`.
ALTER TABLE "prospeccao_config" ADD COLUMN IF NOT EXISTS "salaWabaId" TEXT;
ALTER TABLE "prospeccao_config" ADD COLUMN IF NOT EXISTS "salaWabaPhoneNumber" TEXT;
ALTER TABLE "prospeccao_config" ADD COLUMN IF NOT EXISTS "salaWabaVistoEm" TIMESTAMP(3);
