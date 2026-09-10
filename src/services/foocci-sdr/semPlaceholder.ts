/**
 * ⛔ NUNCA SAIR COM VARIÁVEL NÃO RESOLVIDA — a última conferência antes da Meta.
 *
 * ── O DANO QUE ESTA FUNÇÃO EXISTE PARA IMPEDIR ──────────────────────────────
 *
 * O pré-voo do modelo confere QUANTAS variáveis saem. Ele não olha o CONTEÚDO
 * delas. Um parâmetro montado a partir de um campo vazio, de um `undefined` que
 * virou string no caminho, ou de um rascunho com `[nome do restaurante]` ainda
 * escrito passa por todas as travas de contagem — e chega inteiro no WhatsApp
 * de um estranho, em nome da empresa.
 *
 * A Meta aceita numa boa: ela confere formato, não sentido. Quem lê "Olá
 * undefined, aqui é a Foocci" é o prospecto, e a primeira impressão é a única
 * que a abordagem fria tem. Uma mensagem dessas custa mais do que não mandar
 * nada — bloquear aqui perde um contato; mandar queima o lead e a reputação do
 * número junto.
 *
 * ── POR QUE ELA DEVOLVE O TRECHO, E NÃO `true` ──────────────────────────────
 *
 * `true` diria "tem alguma coisa errada" e mandaria quem investiga abrir o
 * payload à mão. O trecho ofensor entra na frase da recusa e resolve sozinho:
 * `{{2}}` sobrando é modelo trocado, `[cidade]` é rascunho não preenchido,
 * `undefined` é dado que não chegou. Três consertos diferentes.
 *
 * Função **pura**: sem ambiente, sem banco, sem rede. É por isso que ela pode
 * ser medida caso a caso e chamada de qualquer ponto do caminho de envio.
 */

/**
 * `{{1}}`, `{{ 2 }}` — variável do modelo que ninguém substituiu.
 *
 * É o defeito mais literal dos três: o texto ainda carrega o marcador que a
 * Meta usa. Sair assim mostra ao lead a mecânica do envio.
 */
const VARIAVEL_SOBRANDO = /\{\{\s*\d+\s*\}\}/;

/**
 * `[qualquer coisa entre colchetes]` — o rascunho que virou mensagem.
 *
 * É como se escreve modelo antes de preencher: `[nome]`, `[link do site]`,
 * `[cidade]`. Nenhuma abordagem legítima desta casa usa colchete, e o custo do
 * falso positivo (uma mensagem barrada e revisada por gente) é muito menor que
 * o do falso negativo (o rascunho chegando ao cliente).
 */
const COLCHETE_DE_RASCUNHO = /\[[^\][]+\]/;

/**
 * `undefined` e `null` como PALAVRA — o dado que não chegou, coagido a texto.
 *
 * ⚠️ `\b` de propósito: sem ele, "anulado" e "indefinido" seriam barrados, e
 * uma trava que barra texto legítimo é desligada na primeira semana.
 * Insensível a caixa porque a coerção pode ter passado por um `toUpperCase`
 * no meio do caminho.
 */
const NAO_CHEGOU = /\b(?:undefined|null)\b/i;

/**
 * `NaN` — a conta que não fechou.
 *
 * ⚠️ Sensível a caixa, ao contrário dos outros dois: `nan` insensível barraria
 * palavras e nomes reais. `NaN` escrito assim é sempre um número que virou
 * texto sem ninguém conferir.
 */
const CONTA_QUEBRADA = /\bNaN\b/;

/**
 * O trecho ofensor, ou `null` quando o texto está limpo.
 *
 * A ordem das conferências é a do diagnóstico, não a do acaso: marcador do
 * modelo primeiro (o mais grave e o mais fácil de reconhecer), rascunho depois,
 * e por último os valores que vazaram do código.
 */
export function temPlaceholderNaoResolvido(texto: string | null | undefined): string | null {
  const t = texto ?? "";
  if (!t) return null;

  for (const padrao of [VARIAVEL_SOBRANDO, COLCHETE_DE_RASCUNHO, NAO_CHEGOU, CONTA_QUEBRADA]) {
    const achado = t.match(padrao);
    if (achado) return achado[0];
  }

  return null;
}
