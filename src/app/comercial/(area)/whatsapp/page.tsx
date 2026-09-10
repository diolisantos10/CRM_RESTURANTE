/**
 * A CONFERÊNCIA DO CANAL — a tela que responde "as chaves da Meta funcionam?".
 *
 * ── POR QUE ELA É UMA TELA, E NÃO UM COMANDO ────────────────────────────────
 *
 * Quem cola as chaves no Railway é o dono, e ele não abre terminal. Até aqui a
 * única forma de saber se elas serviam era esperar um cliente escrever — e
 * descobrir no silêncio dele que alguma coisa estava errada.
 *
 * ── O QUE ELA MOSTRA, E POR QUE NESTA ORDEM ─────────────────────────────────
 *
 * Primeiro **o número que a Meta devolve**. É o único dado que prova que a
 * chave certa está apontando para o telefone certo — em 26/08/2026 duas telas
 * da Meta mostraram identificadores diferentes para o mesmo número, e nenhuma
 * checagem de "a variável está preenchida?" teria pego isso.
 *
 * Depois as três chaves, com o que cada uma faz. Presença nunca é prova de que
 * a credencial serve (guardrail 1) — por isso a presença vem DEPOIS da prova.
 *
 * ── ⭐ E DEPOIS, O QUE O LEAD REALMENTE RECEBE (10/09/2026) ──────────────────
 *
 * A tela provava que as chaves funcionavam e não dizia uma palavra sobre a
 * mensagem. Quem opera não abre o painel da Meta: dava para rodar semanas sem
 * ninguém nunca ter lido a frase que sai em nome da empresa para um estranho.
 * O bloco dos modelos fecha isso — a conta, o teto que a Meta concede, a
 * qualidade do número e o corpo aprovado de cada modelo, inteiro.
 *
 * A ordem é de dentro para fora: primeiro se as chaves servem, depois de qual
 * conta e com que teto, e por último o que é dito. Ler o texto de uma mensagem
 * que não tem como sair é o tipo de conferência que dá conforto sem dar prova.
 */

import { ConferenciaClient } from "./ConferenciaClient";
import { ModelosClient } from "./ModelosClient";

export const dynamic = "force-dynamic";

export const metadata = { title: "Canal de vendas — conferência" };

export default function Page() {
  return (
    <div className="min-h-full bg-canvas px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-3xl">
        <header className="mb-5">
          <h1 className="text-2xl font-semibold tracking-[-.02em] text-ink">
            O WhatsApp de vendas
          </h1>
          <p className="mt-1 max-w-[62ch] text-[13.5px] leading-relaxed text-muted">
            Esta tela pergunta à Meta, agora, se as chaves que estão no ar
            alcançam o número da Foocci, de qual conta ela fala, quanto a Meta
            deixa falar por dia — e mostra o texto exato que o lead recebe.
            Nenhum botão daqui manda mensagem para ninguém.
          </p>
        </header>

        <ConferenciaClient />

        <ModelosClient />
      </div>
    </div>
  );
}
