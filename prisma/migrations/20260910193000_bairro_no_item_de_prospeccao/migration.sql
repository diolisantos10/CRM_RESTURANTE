-- O bairro do item de prospecção.
--
-- O modelo aprovado na Meta (`abordagem_restaurante_fria`) diz "encontramos o
-- contato de vocês em {{3}}", e o mapa do Diretor Geral (10/09/2026) manda
-- bairro + ", " + cidade. A lista tinha o bairro e a tabela o jogava fora.
ALTER TABLE "itens_de_prospeccao"
  ADD COLUMN IF NOT EXISTS "bairro" TEXT;
