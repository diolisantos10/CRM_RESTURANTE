-- Custo de IA sem restaurante dono.
--
-- POR QUE: `ai_interaction_logs.restaurantId` era NOT NULL, e por isso toda
-- chamada de IA que não nasce dentro de um restaurante (SDR, biblioteca de
-- agentes, mineração de FAQ, oficina de peças, extração de nota em contexto
-- administrativo) simplesmente NÃO PODIA ser registrada. O gasto existia e
-- ficava fora do radar. "Não sei de quem é" passa a ser um registro; antes era
-- um buraco.
--
-- PONTO DE REVERSÃO: esta migração é uma AMPLIAÇÃO (drop de NOT NULL). Para
-- desfazer, apagar as linhas órfãs e reapertar:
--   DELETE FROM "ai_interaction_logs" WHERE "restaurantId" IS NULL;
--   ALTER TABLE "ai_interaction_logs" ALTER COLUMN "restaurantId" SET NOT NULL;
-- Nenhum dado existente é alterado por esta migração.

ALTER TABLE "ai_interaction_logs" ALTER COLUMN "restaurantId" DROP NOT NULL;
