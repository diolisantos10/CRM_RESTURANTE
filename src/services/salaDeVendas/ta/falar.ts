/**
 * FALAR — onde o determinístico e o modelo se encontram, nesta ordem.
 *
 * ── A ORDEM É A DOUTRINA, E ELA NÃO É NEGOCIÁVEL ────────────────────────────
 *
 * 1. **O gatilho de handoff é decidido em código, ANTES do modelo.**
 *
 *    Quando o lead pede uma pessoa, pede desconto, ou fica bravo, quem decide
 *    parar é `responder()` — lendo o texto com regras fixas. O modelo não vota.
 *
 *    Deixar o modelo decidir se escala seria entregar a única trava que protege
 *    o cliente irritado à mesma peça que erra sob pressão. Um modelo simpático
 *    tenta resolver; e "tentar resolver" um pedido de desconto significa
 *    negociar, que é fora da alçada dele por decisão, não por capacidade.
 *
 * 2. **Se não é caso de gente, o modelo redige.**
 *
 *    Aí sim: conversa de verdade, com o conhecimento do produto atrás.
 *
 * 3. **Se o modelo falhar ou for reprovado, a resposta determinística sai.**
 *
 *    Dura, mas verdadeira, e na hora. Lead esperando é pior que resposta seca.
 *
 * ── O QUE ISSO SIGNIFICA NA PRÁTICA ─────────────────────────────────────────
 *
 * O pior dia deste arquivo é igual ao melhor dia de ontem. Não há caminho em
 * que o TA fique mudo, e não há caminho em que ele escale por conta própria ou
 * deixe de escalar porque o modelo achou que dava para contornar.
 */

import { responder, type Resposta } from "./responder";
import { pensar, type FalaDoTA } from "./cerebro";
import { VERSAO_1, type TextoDaVersao } from "./ficha";
import type { PosturaDoAgente } from "./oficio";
import type { Turno } from "./responder";

export interface FalaFinal {
  texto: string;
  apoiadoEm: Array<{ id: string; fonte: string }>;
  perguntouIndice: number | null;
  handoff: Resposta["handoff"];
  porque: string;
  /** De onde veio o texto — o que a tela de ensaio mostra em cima. */
  origem: FalaDoTA["origem"] | "handoff-deterministico";
  /** As reprovações do verificador no caminho. Vazio no caminho feliz. */
  reprovacoes: FalaDoTA["reprovacoes"];
}

/**
 * O TA fala.
 *
 * `responder()` continua existindo, continua testada e continua sendo o chão.
 * Esta função não a substitui: ela decide **quando** o modelo entra.
 */
export async function falar(
  turno: Turno,
  ficha: TextoDaVersao = VERSAO_1,
  postura: PosturaDoAgente = "qualificar",
): Promise<FalaFinal> {
  const base = responder(turno, ficha);

  // ── 1. Caso de gente: o modelo não entra, e não é por economia ──────────
  //
  // A fala do handoff é curta e fixa de propósito. É a única mensagem do TA em
  // que floreio atrapalha: quem pediu uma pessoa quer saber que uma pessoa vem,
  // não quer uma última tentativa de contornar.
  if (base.handoff.deve && !ehSoFaltaDeSaber(base)) {
    return {
      texto: base.texto,
      apoiadoEm: base.apoiadoEm,
      perguntouIndice: base.perguntouIndice,
      handoff: base.handoff,
      porque: base.porque,
      origem: "handoff-deterministico",
      reprovacoes: [],
    };
  }

  // ── 2. O modelo redige, com o determinístico como chão ──────────────────
  //
  // Quando chegamos aqui por `ehSoFaltaDeSaber`, o chão CONTINUA sendo o "não
  // sei" com handoff — é ele que sai se o modelo falhar ou for reprovado. A
  // chance dada ao modelo não afrouxa a escalada; ela só evita escalar antes de
  // perguntar a quem tem o Manual na mão.
  const fala = await pensar(
    {
      mensagem: turno.mensagem,
      nome: turno.nome,
      historico: turno.historico,
      ficha,
      // ⚠️ Só chega aqui quem NÃO é caso de gente — o handoff determinístico
      // acima já devolveu. Ou seja: por mais agressivo que o closer seja, ele
      // nunca é consultado quando o lead pediu uma pessoa, pediu desconto ou
      // ficou bravo. A trava é a ordem do arquivo, não uma linha do ofício.
      postura,
      // O que a casa já sabe dele, e como conduzir esta conversa. Os dois vêm
      // prontos de `memoria.ts`; aqui só se repassa, para o modelo não ter de
      // reextrair do histórico cru a cada turno.
      memoria: turno.memoria,
      conduta: turno.conduta,
    },
    () => ({
      texto: base.texto,
      origem: "chao-deterministico" as const,
      apoiadoEm: base.apoiadoEm,
      reprovacoes: [],
      porque: base.porque,
    }),
  );

  // Se o modelo entregou, a escalada por "não sei" **não acontece** — ele soube.
  // Se caiu no chão, ela acontece exatamente como aconteceria sem o modelo.
  const respondeuDeVerdade = fala.origem !== "chao-deterministico";
  const handoff = respondeuDeVerdade && ehSoFaltaDeSaber(base)
    ? { deve: false, motivo: null }
    : base.handoff;

  return {
    texto: fala.texto,
    apoiadoEm: fala.apoiadoEm,
    perguntouIndice: indiceRealmentePerguntado(base, fala),
    handoff,
    porque: fala.porque,
    origem: fala.origem,
    reprovacoes: fala.reprovacoes,
  };
}

/**
 * A sondagem só anda quando o TA REALMENTE perguntou alguma coisa.
 *
 * ── O DEFEITO QUE ISTO CORRIGE ──────────────────────────────────────────────
 *
 * `responder()` calcula a próxima pergunta da sondagem e a inclui no texto
 * DELE. Quando o modelo passou a redigir, o texto que sai é outro — mas o
 * índice continuava sendo devolvido como se a pergunta tivesse sido feita.
 *
 * O resultado é uma memória que se descola da conversa: depois de cinco turnos a
 * lista está inteira marcada como "já perguntei", e o TA ficou sem sondagem sem
 * ter feito uma única pergunta. Ninguém notaria olhando a tela — a conversa
 * simplesmente pararia de avançar, e pareceria falta de assunto.
 *
 * ── A REGRA, E POR QUE ELA É ESTA ───────────────────────────────────────────
 *
 * Quando o texto veio do caminho determinístico, o índice vale: aquele texto
 * contém a pergunta, palavra por palavra.
 *
 * Quando veio do modelo, não dá para saber QUAL pergunta ele fez — ele
 * reformula, junta duas, ou nem pergunta. Dá para saber se ele perguntou
 * ALGUMA: se o texto tem interrogação. Sem ela, nada é marcado.
 *
 * É aproximação, e assumida como tal. A alternativa — pedir ao modelo que
 * devolva o índice — trocaria uma imprecisão pequena por uma dependência de
 * ele obedecer ao formato, que é a parte dele em que menos se pode confiar.
 * E o erro desta aproximação é o barato: na dúvida, não marca — o pior caso é
 * o TA insistir num assunto, não é ele emudecer.
 */
function indiceRealmentePerguntado(base: Resposta, fala: FalaDoTA): number | null {
  if (fala.origem === "chao-deterministico") return base.perguntouIndice;
  return fala.texto.includes("?") ? base.perguntouIndice : null;
}

/**
 * A escalada foi "não sei", ou foi coisa séria?
 *
 * ── POR QUE ESTA DISTINÇÃO EXISTE ───────────────────────────────────────────
 *
 * `responder()` chama gente por motivos muito diferentes entre si, e um deles
 * envelheceu em 26/08/2026:
 *
 *   · **PEDIU_HUMANO, PEDIU_DESCONTO, RISCO** — o lead pediu, ou a conversa
 *     azedou. Nada disso melhora com uma resposta mais bem escrita. Escala, e o
 *     modelo não é nem consultado.
 *   · **INFORMACAO_NAO_CONFIRMADA** — a base de verdade não cobriu a pergunta.
 *     Essa regra nasceu quando o TA conhecia dezesseis frases; hoje ele tem o
 *     Manual Operacional inteiro atrás. Escalar toda pergunta que a base ESTREITA
 *     não responde mandaria quase toda conversa real para a fila humana — e uma
 *     fila que recebe tudo é uma fila que ninguém atende.
 *
 * Então este é o único motivo em que o modelo ganha a chance de responder antes.
 * Se ele responder, não escala. Se não responder, escala como sempre escalou.
 * A trava não afrouxou; ela passou a perguntar antes de disparar.
 */
function ehSoFaltaDeSaber(base: Resposta): boolean {
  return base.handoff.deve && base.handoff.motivo === "INFORMACAO_NAO_CONFIRMADA";
}
