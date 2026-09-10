/**
 * O LINK OFICIAL — e por que ele precisou virar um arquivo.
 *
 * ── O DEFEITO, LIDO NA CONVERSA DE 09/09/2026 ───────────────────────────────
 *
 * O lead recebeu, repetidas vezes, a string literal:
 *
 *     "dá uma olhada aqui: [link do site]"
 *
 * A primeira suspeita — um template com variável não substituída — estava
 * errada. Não existe `[link do site]` em lugar nenhum do repositório. A causa é
 * pior e mais simples:
 *
 *   · `oficio.ts` mandava, em português: *"o próximo passo é o link do site"*;
 *   · **nenhuma URL era passada ao modelo.** Nenhuma. Não havia um `http` em
 *     todo o diretório `ta/`;
 *   · o modelo obedeceu a ordem que recebeu, do único jeito que podia: escreveu
 *     um espaço reservado onde o link deveria estar.
 *
 * A lição não é sobre modelo: **instrução que manda usar uma coisa que o agente
 * não possui produz invenção, não recusa.** Ou se dá a coisa, ou não se manda
 * usá-la.
 *
 * ── POR QUE DERIVADO, E NUNCA DIGITADO ──────────────────────────────────────
 *
 * A URL vem de `CANONICAL_PUBLIC_BASE_URL`, a mesma que o resto do produto usa
 * para montar link de pedido e de cardápio. Digitar "https://foocci.com.br"
 * aqui criaria a quinta cópia de um endereço que já mudou de host uma vez — e a
 * cópia que ninguém lembra de trocar é a que vai para o cliente.
 */

import { CANONICAL_PUBLIC_BASE_URL } from "@/lib/public-base-url";

/**
 * As páginas públicas que o TA pode mandar. Curta de propósito.
 *
 * Cada caminho aqui existe em `src/app/site/(gated)/` — conferido pelo teste,
 * que lê o disco. Uma lista que envelhece manda o lead para um 404, e um 404 no
 * meio de uma venda custa a venda.
 */
export const PAGINAS_OFICIAIS = {
  precos: "/site/precos",
  comoFunciona: "/site/como-funciona",
  demonstracao: "/site/demonstracao",
  solucoes: "/site/solucoes",
} as const;

export type PaginaOficial = keyof typeof PAGINAS_OFICIAIS;

/** A URL completa de uma página oficial. */
export function linkOficial(pagina: PaginaOficial = "precos"): string {
  return `${CANONICAL_PUBLIC_BASE_URL}${PAGINAS_OFICIAIS[pagina]}`;
}

/** Todas as URLs que o TA tem permissão de escrever. */
export function linksPermitidos(): string[] {
  return (Object.keys(PAGINAS_OFICIAIS) as PaginaOficial[]).map(linkOficial);
}

/**
 * O bloco que entra no prompt — o link na mão do modelo, com quando usá-lo.
 *
 * ⚠️ Diz o endereço EXATO e manda copiar. Sem o "copie exatamente", o modelo
 * reescreve a URL: encurta, tira o `/site`, inventa `/planos`. Um link quase
 * certo é um link quebrado.
 */
export function blocoDosLinks(): string {
  return [
    "OS ÚNICOS ENDEREÇOS QUE VOCÊ PODE MANDAR — copie exatamente, sem encurtar:",
    `- planos e preços: ${linkOficial("precos")}`,
    `- como funciona: ${linkOficial("comoFunciona")}`,
    `- pedir uma demonstração: ${linkOficial("demonstracao")}`,
    "",
    "Se precisar mandar um link que não está nesta lista, NÃO invente o endereço:",
    "diga que vai pedir para alguém do time mandar. Nunca escreva um endereço",
    "entre colchetes, nunca escreva \"link do site\", e nunca prometa um link que",
    "você não colou na mensagem.",
  ].join("\n");
}
