/**
 * A VERDADE DO FOOCCI — o que o TA pode afirmar, e de onde cada frase veio.
 *
 * ── POR QUE ESTE ARQUIVO É O PRIMEIRO, E NÃO O PROMPT ───────────────────────
 *
 * Um vendedor de IA sem base de verdade **inventa**. Não é risco teórico: é o
 * comportamento padrão de um modelo perguntado sobre um produto que ele não
 * conhece. E inventar integração, recurso ou prazo é o defeito mais caro que
 * esta função pode ter — o cliente compra pela promessa e descobre na
 * implantação.
 *
 * Por isso a ordem aqui é: **primeiro o que se pode dizer, depois quem diz**.
 *
 * ── DERIVA, NUNCA TRANSCREVE ────────────────────────────────────────────────
 *
 * Nenhuma frase de venda é digitada neste arquivo. Tudo vem de fonte que já
 * existe e que o CEO já aprovou:
 *
 *   · as nove perguntas do site  → `@/lib/site/faq`
 *   · a tabela de preço          → `@/lib/billing/pricing`, via `precos.ts`
 *   · o posicionamento dos planos→ `@/lib/site/plans`
 *
 * O teste lê o código-fonte deste arquivo e reprova se aparecer uma afirmação
 * de venda escrita à mão. Uma frase digitada aqui viveria fora do site, fora da
 * revisão e fora do dia em que o CEO mudasse de ideia.
 *
 * ── O PISO DE ADMISSÃO, E A LIÇÃO DE 04/08 ──────────────────────────────────
 *
 * `manualRetrieval` desta casa já pagou esta lição: enquanto a busca **nunca
 * devolvia vazio**, toda pergunta voltava com um documento, e o agente
 * apresentava o documento mais parecido como verdade. Medido no corpus real:
 * 30 de 30 perguntas devolviam guia, inclusive "como emito nota fiscal", que
 * casava com o guia de acompanhar pedidos.
 *
 * Aqui vale a mesma regra, pelo mesmo motivo: sem casamento forte o suficiente,
 * **devolvemos nada** — e o TA diz que não sabe. Ausência de informação não é
 * informação.
 */

import { FAQS } from "@/lib/site/faq";
import { PLANS } from "@/lib/site/plans";
import { COMMISSION_RATES, COMMISSION_SOURCE, MARKETPLACE_NAME } from "@/lib/site/commissionRates";
import { SERVICOS_A_PARTE, NOTA_FISCAL_A_PARTE, MAIS_DE_UMA_LOJA } from "@/lib/site/servicosAParte";
import { tabelaPublicada, descontoPublicado } from "../precos";

/** De onde a frase veio. Vai junto na resposta, para a Sala poder auditar. */
export type FonteDaVerdade =
  | "faq-do-site"
  | "tabela-de-preco"
  | "posicionamento-do-plano"
  /** A comissão do marketplace, com a fonte pública que o site já publica. */
  | "comissao-do-marketplace"
  /** O que é cobrado FORA da mensalidade. A pergunta que mais gera atrito. */
  | "servico-a-parte";

export interface ItemDeVerdade {
  /** Chave estável, para o teste e para a trilha. */
  id: string;
  fonte: FonteDaVerdade;
  /** A pergunta que este item responde, do jeito que o lead faria. */
  sobre: string;
  /** O que se pode afirmar. Texto pronto para o lead ler. */
  texto: string;
}

/** Sem acento e sem pontuação, para comparar palavra com palavra. */
function normalizar(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Palavras que não distinguem nada.
 *
 * Sem esta lista, "o", "de" e "que" casam com tudo e o piso de admissão deixa
 * de ser piso — foi exatamente assim que "pedido", presente em 21 dos 36 guias,
 * fazia "nota fiscal do pedido" casar com o guia errado.
 */
const VAZIAS = new Set(
  ("a o e de da do das dos em no na nos nas um uma uns umas para por com sem que " +
    "se ao aos as os e ou mas como qual quais quanto quanta é sao são tem ter " +
    "voce voces eu meu minha isso isto esse essa aqui la ja nao sim").split(" "),
);

function palavras(s: string): string[] {
  return normalizar(s)
    .split(" ")
    .filter((p) => p.length > 2 && !VAZIAS.has(p));
}

/**
 * A base inteira, montada das fontes.
 *
 * É função e não constante porque a tabela de preço é derivada em tempo de
 * execução — congelá-la num módulo faria o TA anunciar o preço do dia do
 * deploy.
 */
/**
 * Resposta que só faz sentido para quem está OLHANDO O SITE.
 *
 * ── ACHADO DO PRIMEIRO ENSAIO (25/08/2026) ─────────────────────────────────
 *
 * O TA foi ensaiado com "oi, vi o site de vocês" e respondeu, com apoio na
 * FAQ: *"Tire suas dúvidas com os nossos agentes pelo botão de contato aqui do
 * site."*
 *
 * A frase está certa no site e é absurda no WhatsApp: manda a pessoa que **já
 * está falando com a gente** voltar ao site para falar com a gente. O mesmo
 * vale para "os valores estão na página de preços" — o TA tem a tabela na mão e
 * mandaria o lead procurar sozinho.
 *
 * A regra é derivada do texto, e não uma lista escrita à mão: item que empurra
 * o leitor de volta para a página não serve a quem já saiu dela.
 */
const APONTA_PARA_O_SITE = /(aqui do site|neste site|no site|bot[ãa]o de contato|p[áa]gina de pre[çc]os|na p[áa]gina)/i;

export function baseDeVerdade(): ItemDeVerdade[] {
  const itens: ItemDeVerdade[] = [];

  // 1. As nove do site, menos as que só funcionam DENTRO do site.
  FAQS.forEach((f, i) => {
    if (APONTA_PARA_O_SITE.test(f.a)) return;
    itens.push({
      id: `faq-${i + 1}`,
      fonte: "faq-do-site",
      sobre: f.q,
      texto: f.a,
    });
  });

  // 2. Preço — montado da tabela viva, nunca digitado.
  for (const plano of tabelaPublicada()) {
    const mensal = plano.ciclos.find((c) => c.ciclo === "MENSAL")!;
    const anual = plano.ciclos.find((c) => c.ciclo === "ANUAL")!;
    const posicionamento = PLANS.find((p) => p.id === plano.id);

    itens.push({
      id: `preco-${plano.id}`,
      fonte: "tabela-de-preco",
      sobre: `quanto custa o plano ${plano.nome}`,
      // Duas frases, e não três (era "...por mês. No anual sai por... por mês.
      // Na primeira cobrança..."): o teto do verificador é de quatro frases, e
      // no primeiro contato a apresentação e o link já gastam duas. A
      // informação é a mesma — mensal, anual e a primeira cobrança pela metade.
      texto:
        `O plano ${plano.nome} é ${mensal.doCiclo} por mês, ou ${anual.equivalenteAoMes} por mês no anual. ` +
        `Na primeira cobrança do mensal você paga ${mensal.primeiraCobranca}, porque o primeiro mês é pela metade.`,
    });

    if (posicionamento) {
      itens.push({
        id: `plano-${plano.id}`,
        fonte: "posicionamento-do-plano",
        sobre: `para que serve o plano ${plano.nome}`,
        texto: `${plano.nome}: ${posicionamento.onlyHere} ${posicionamento.forWho}`,
      });
    }
  }

  // 3. O desconto — a única regra de abatimento que existe.
  const d = descontoPublicado();
  if (d.sabe) {
    itens.push({
      id: "desconto",
      fonte: "tabela-de-preco",
      sobre: "tem desconto",
      texto: d.valor.regra,
    });
  }

  // 4. A comissão do marketplace.
  //
  // ── POR QUE ISTO É AFIRMAÇÃO, E NÃO CONHECIMENTO DE FUNDO ─────────────────
  //
  // "Quanto o iFood leva?" é a pergunta que faz o dono parar para ouvir, e é
  // também a que um modelo solto responde de cabeça — com um número que ele leu
  // em algum blog. Aqui o número tem dono: é o mesmo que a calculadora do site
  // publica, com a fonte e a data que a página mostra ao lado.
  //
  // ⚠️ O nome do marketplace vem de `MARKETPLACE_NAME` porque a decisão de
  // nomeá-lo é do CEO e já mudou uma vez (não nomear em 03/08, nomear em 04/08).
  // Digitado aqui, o TA continuaria dizendo o nome no dia em que a decisão
  // voltasse atrás.
  itens.push({
    id: "comissao-marketplace",
    fonte: "comissao-do-marketplace",
    sobre: `quanto o ${MARKETPLACE_NAME} cobra de comissão marketplace taxa`,
    texto:
      `Com entrega própria, a comissão fica em torno de ${pct(COMMISSION_RATES.own.rate)} ` +
      `(${COMMISSION_RATES.own.breakdown}). Com a entrega do marketplace, sobe para ` +
      `cerca de ${pct(COMMISSION_RATES.marketplace.rate)}. ` +
      `Esses números são de ${COMMISSION_SOURCE.label.toLowerCase()}.`,
  });

  // 5. O que é cobrado à parte.
  //
  // A pergunta "tem alguma taxa além da mensalidade?" é das que mais geram
  // atrito quando a resposta aparece depois. O TA precisa poder respondê-la —
  // e a resposta honesta inclui o "fazer você mesmo não custa nada".
  for (const s of SERVICOS_A_PARTE) {
    itens.push({
      id: `a-parte-${normalizarId(s.name)}`,
      fonte: "servico-a-parte",
      sobre: `${s.name} custa taxa além da mensalidade cobrado à parte`,
      texto: `${s.name}: ${s.desc} O preço é ${s.price.toLowerCase()}.`,
    });
  }

  // Mais de uma loja — a pergunta que a medição de cobertura pegou vazia, e que
  // é das primeiras de quem tem duas lojas.
  itens.push({
    id: "mais-de-uma-loja",
    fonte: "servico-a-parte",
    sobre: MAIS_DE_UMA_LOJA.pergunta,
    texto: MAIS_DE_UMA_LOJA.resposta,
  });

  itens.push({
    id: "a-parte-nota-fiscal",
    fonte: "servico-a-parte",
    sobre: "nota fiscal nfce quanto custa emitir",
    texto: `${NOTA_FISCAL_A_PARTE.name}: ${NOTA_FISCAL_A_PARTE.desc}`,
  });

  return itens;
}

/** 0.152 → "15,2%". O site mostra assim, e o TA fala como o site escreve. */
function pct(fracao: number): string {
  return `${(fracao * 100).toFixed(1).replace(".", ",").replace(",0", "")}%`;
}

function normalizarId(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-");
}

// ── A BUSCA ──────────────────────────────────────────────────────────────────

export interface Achado {
  item: ItemDeVerdade;
  /** Quantos termos da pergunta o item cobre, de 0 a 1. */
  cobertura: number;
}

/**
 * Quanto da PERGUNTA o item cobre — e não quanto do item a pergunta cobre.
 *
 * A direção importa. Medir ao contrário premia item curto: um texto de cinco
 * palavras que casa duas parece ótimo, e não respondeu nada.
 */
export const COBERTURA_MINIMA = 0.34;

/**
 * O que a base tem sobre esta pergunta. Vazio quando não tem nada forte.
 *
 * ⚠️ **Devolver `[]` é um resultado, não uma falha.** É ele que faz o TA dizer
 * "não sei" em vez de responder com o item mais parecido — que é como um
 * agente ensina o que não existe com cara de fundamentado.
 */
export function buscarNaVerdade(pergunta: string, base = baseDeVerdade()): Achado[] {
  const termos = palavras(pergunta);
  if (termos.length === 0) return [];

  return base
    .map((item) => {
      const texto = new Set(palavras(`${item.sobre} ${item.texto}`));
      const cobertos = termos.filter((t) => texto.has(t)).length;
      return { item, cobertura: cobertos / termos.length };
    })
    .filter((a) => a.cobertura >= COBERTURA_MINIMA)
    .sort((a, b) => b.cobertura - a.cobertura);
}
