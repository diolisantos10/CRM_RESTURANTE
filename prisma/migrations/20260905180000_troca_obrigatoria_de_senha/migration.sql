-- ⛔ TROCA OBRIGATÓRIA DE SENHA NO PRIMEIRO ACESSO.
--
-- Ordem do CEO, 05/09/2026: "deveria haver uma forma de a pessoa receber uma
-- senha provisória e já trocar. Esse é o procedimento padrão em qualquer
-- empresa."
--
-- O buraco era real: a casa sorteava a senha, ela aparecia UMA vez na tela de
-- quem estava criando o acesso — e valia para sempre. Quem criou ficava sabendo
-- a senha de quem entra, indefinidamente, e nada no sistema pedia a troca.
--
-- ⚠️ `deveTrocarSenha` nasce FALSE nesta migração, e é deliberado: marcar todo
-- mundo que já existe como "tem de trocar" trancaria a casa inteira para fora
-- no primeiro deploy — inclusive quem está no meio de um atendimento. A trava
-- vale para os acessos NOVOS e para toda troca feita pelo Admin daqui em diante.
--
-- ⚠️ E `senhaDefinidaEm` nasce NULO, que é a verdade: ninguém aqui definiu a
-- própria senha ainda. Nulo é "não sei", nunca "está tudo certo" — é o que
-- permite, depois, medir quantos acessos antigos seguem com senha de terceiro
-- sem precisar adivinhar.

ALTER TABLE "internal_users"
  ADD COLUMN "deveTrocarSenha" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "senhaDefinidaEm" TIMESTAMP(3);
