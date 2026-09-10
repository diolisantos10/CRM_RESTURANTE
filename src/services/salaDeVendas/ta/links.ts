/**
 * OS LINKS QUE O TA PODE MANDAR — e de onde cada um vem.
 *
 * ── POR QUE ISTO É UM ARQUIVO, E NÃO QUATRO STRINGS NO PROMPT ───────────────
 *
 * Pedido do CEO (09/09/2026): o agente tem que ENTREGAR o link quando a pessoa
 * pede preço, demo ou como assinar. Até aqui ele descrevia o caminho com
 * palavras ("a página de preços") e a pessoa ia procurar sozinha — no WhatsApp,
 * isso é a mesma coisa que não responder.
 *
 * O endereço NÃO é digitado aqui. Cada caminho vem da mesma constante que o site
 * usa para montar o botão (`@/components/marketing/config`): se o formulário
 * mudar de página de novo — já mudou uma vez, em 06/08 —, o TA muda junto, no
 * mesmo commit, sem ninguém lembrar deste arquivo.
 *
 * ── O QUE CADA UM É, E POR QUE ESSE E NÃO OUTRO ─────────────────────────────
 *
 *   · **site**    → `/site`, a vitrine (`src/app/site/(gated)/page.tsx`).
 *   · **precos**  → `/site/precos` (`src/app/site/(gated)/precos/page.tsx`),
 *                   os três planos e o formulário no fim.
 *   · **demo**    → `/site/experimente` (`src/app/site/(gated)/experimente/page.tsx`),
 *                   a DEGUSTAÇÃO — a pessoa entra no produto, na padaria de
 *                   demonstração. ⚠️ E não `DEMO_URL`: aquela é o FORMULÁRIO de
 *                   "agende uma demonstração", a porta de entrada do SDR. Quem
 *                   está escrevendo no WhatsApp da Sala **já passou por essa
 *                   porta** — mandá-la de volta ao formulário é a mesma lição de
 *                   `verdade.ts` (não se manda quem já está falando com a gente
 *                   ir ao site falar com a gente). Quem quer VER o produto vê
 *                   agora, sem fila.
 *   · **assinar** → `/contratar/novo` (`src/app/contratar/novo/page.tsx`), o
 *                   checkout self-service que existe e cobra de verdade.
 */

import {
  ASSINAR_URL,
  EXPERIMENTE_URL,
  PRECOS_URL,
} from "@/components/marketing/config";
import { DESTINO_DA_RAIZ } from "@/lib/canonicalHost";

/**
 * A origem pública. A casa não tem constante de servidor para ela —
 * `canonicalHost.ts` a deriva do cabeçalho de cada requisição, e o TA responde
 * de dentro de um webhook, sem requisição de navegador. Uma linha, e ela vive
 * aqui para ser a única.
 */
export const ORIGEM_PUBLICA = "https://foocci.com.br";

export type LinkDoFoocci = "site" | "precos" | "demo" | "assinar";

export const LINKS_DO_FOOCCI: Readonly<Record<LinkDoFoocci, string>> = {
  site: `${ORIGEM_PUBLICA}${DESTINO_DA_RAIZ}`,
  precos: `${ORIGEM_PUBLICA}${PRECOS_URL}`,
  demo: `${ORIGEM_PUBLICA}${EXPERIMENTE_URL}`,
  assinar: `${ORIGEM_PUBLICA}${ASSINAR_URL}`,
};

/**
 * O que a pessoa pediu — quando ela pediu uma coisa OBJETIVA.
 *
 * Lista curta e literal, como as de `responder.ts`. A ordem importa: "quero
 * assinar o plano" cita plano E assinatura, e o que ela quer é assinar. Preço
 * vem por último entre os três de negócio porque é a palavra mais frequente e
 * a menos específica.
 *
 * `null` não afirma nada: só quer dizer que a mensagem não pediu link nenhum.
 */
const PEDE_ASSINAR =
  /\b(assin\w*|contrat\w*|fech(ar|o) (com|o plano|contigo)|como (eu )?(come[çc]o|entro|cadastro)|quero (come[çc]ar|entrar|o plano|o foocci)|cadastr\w*)\b/i;
const PEDE_DEMO =
  /\b(demo\w*|testar|teste|experimentar|experimento|ver funcionando|ver na pr[áa]tica|degusta\w*|me mostra)\b/i;
const PEDE_PRECO =
  /\b(pre[çc]os?|quanto (custa|é|fica|sai)|valor(es)?|planos?|mensalidade|tabela)\b/i;
// ⚠️ "site" sozinho NÃO conta: "oi, vi o site de vocês" é a abertura mais comum
// de todas, e não é pedido de link — é a pessoa dizendo de onde veio. Só vale
// quando ela PEDE: "manda o link", "qual o site", "passa o endereço".
const PEDE_SITE =
  /\blink\b|\b(manda|mandar|passa|passar|qual|tem|me d[áa])\b[^.?!]{0,20}\b(site|endere[çc]o|p[áa]gina)\b/i;

export function linkPedido(mensagem: string): LinkDoFoocci | null {
  const m = mensagem ?? "";
  if (PEDE_ASSINAR.test(m)) return "assinar";
  if (PEDE_DEMO.test(m)) return "demo";
  if (PEDE_PRECO.test(m)) return "precos";
  if (PEDE_SITE.test(m)) return "site";
  return null;
}

/**
 * A pessoa pediu uma informação objetiva — preço, link, demo, como assinar.
 *
 * É a condição em que o TA responde e PARA, sem pergunta no fim. Quem pergunta
 * "quanto custa?" e recebe o preço mais "e quantas unidades você tem?" sente que
 * a resposta foi o preço da pergunta dele. Pedido do CEO, 09/09/2026.
 */
export function pediuInformacaoObjetiva(mensagem: string): boolean {
  return linkPedido(mensagem) !== null;
}

/** A frase curta que acompanha cada link no caminho determinístico. */
export function fraseComLink(qual: LinkDoFoocci): string {
  switch (qual) {
    case "precos":
      return `Os três planos estão em ${LINKS_DO_FOOCCI.precos}`;
    case "demo":
      return `Dá pra ver o Foocci funcionando agora, sem cadastro: ${LINKS_DO_FOOCCI.demo}`;
    case "assinar":
      return `Pra assinar é por aqui, você escolhe o plano e aceita o termo ali mesmo: ${LINKS_DO_FOOCCI.assinar}`;
    case "site":
      return `O site é ${LINKS_DO_FOOCCI.site}`;
  }
}
