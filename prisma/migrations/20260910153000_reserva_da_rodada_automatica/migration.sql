-- A reserva da rodada automática do dia.
--
-- Medido em 09/09 e 10/09/2026: o cron do GitHub Actions (12:00 UTC) disparou
-- às 15:43 UTC num dia e não disparou no outro. A rodada das 9h passa a ter um
-- agendador interno, e dois agendadores para a mesma rodada exigem uma reserva
-- atômica no banco — senão o atrasado dispara por cima do pontual.
ALTER TABLE "prospeccao_config"
  ADD COLUMN IF NOT EXISTS "ultimaRodadaAutomaticaEm"  TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "ultimaRodadaAutomaticaPor" TEXT;
