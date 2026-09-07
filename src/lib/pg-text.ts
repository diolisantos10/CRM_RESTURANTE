/**
 * pg-text — o byte NUL da comanda, guardado sem quebrar o Postgres.
 *
 * ─── O INCIDENTE, medido ────────────────────────────────────────────────────
 * Entre 31/08 e 06/09 de 2026, TRINTA E TRÊS pedidos do Sushi Cazza foram pagos,
 * confirmados, tiveram a receita registrada no CRM — e a comanda não entrou na
 * fila da impressora. Treze num único turno de jantar. Sempre o mesmo erro:
 *
 *   Invalid `prisma.printJob.createMany()` invocation:
 *   PostgresError { code: "22021", "invalid byte sequence for encoding UTF8: 0x00" }
 *
 * ─── A CAUSA, e ela NÃO é o que parecia ─────────────────────────────────────
 * Por cinco dias eu reportei isto como "um caractere inválido digitado pelo
 * cliente". Estava errado, e a medição desmentiu: um pedido SEM nenhum caractere
 * estranho gera SEIS bytes nulos. Eles são códigos de controle da impressora
 * térmica, emitidos de propósito por `services/print/ticketText.ts`:
 *
 *   BIG_OFF      = GS ! 0x00      volta a fonte ao tamanho normal
 *   EMPHASIS_OFF = ESC E 0x00 …   desliga negrito e double-strike
 *   CUT          = GS V 0x00      corta o papel
 *
 * O `0x00` ali é PARÂMETRO do comando, não sujeira. Toda comanda termina com o
 * corte, então toda comanda carrega pelo menos um — e o Postgres recusa `0x00`
 * em qualquer coluna de texto. Ou seja: **o enfileiramento nunca funcionou**.
 * Não é regressão de uma noite; é um caminho que nasceu quebrado. Medido: em
 * seis dias e três deploys, ZERO enfileiramentos bem-sucedidos e 33 falhas.
 *
 * A suíte não pegou porque `prisma` é dublê no teste, e um `vi.fn()` aceita
 * alegremente o byte que o Postgres recusa. O teste chegava ao objeto, nunca ao
 * banco — e portanto nunca ao papel que a cozinha lê.
 *
 * ─── POR QUE NÃO SE APAGA O BYTE ────────────────────────────────────────────
 * A primeira correção que escrevi removia o `0x00`. Ela está desfeita: apagar o
 * parâmetro transforma `GS V 0` em `GS V`, e a impressora passa a engolir o
 * próximo byte como parâmetro. A comanda sairia com o texto embaralhado — pior
 * que não sair, porque ninguém percebe.
 *
 * ─── O QUE ESTE MÓDULO FAZ ──────────────────────────────────────────────────
 * Troca o `0x00` por um caractere de uso privado ANTES de gravar, e desfaz a
 * troca no ÚNICO ponto que entrega o texto ao Carteiro
 * (`api/print-agent/poll/route.ts`). O agente na loja recebe exatamente os
 * mesmos bytes de hoje: o contrato com a impressora não muda em nada.
 *
 * A sentinela é `U+E000`, da Área de Uso Privado do Unicode. Ela não pode
 * aparecer no texto de verdade: `ticketText.ts:31` já filtra tudo que não é
 * ASCII do conteúdo, e os códigos de controle são todos ASCII baixo.
 */

/** O byte que o Postgres recusa em coluna de texto. */
const NUL = "\u0000";
/** Sentinela: Área de Uso Privado, impossível no texto real da comanda. */
const SENTINELA = "\uE000";

const NUL_GLOBAL = /\u0000/g;
const SENTINELA_GLOBAL = /\uE000/g;

/**
 * Prepara texto binário (ESC/POS) para uma coluna de TEXTO do Postgres.
 * Só o `0x00` muda; todo o resto — acento, espaço, ESC, GS — passa intacto.
 */
export function escapeNulForPg(value: string): string {
  return value.includes(NUL) ? value.replace(NUL_GLOBAL, SENTINELA) : value;
}

/**
 * Desfaz `escapeNulForPg`. Chamado no ponto que entrega o job ao Carteiro, para
 * que ele receba os bytes originais.
 */
export function restoreNulFromPg(value: string): string {
  return value.includes(SENTINELA) ? value.replace(SENTINELA_GLOBAL, NUL) : value;
}

/**
 * Quantos `0x00` a string carrega. Serve para o alerta levar a própria
 * evidência (guardrail 6) sem imprimir conteúdo de cliente no log.
 */
export function countNulBytes(value: string): number {
  let n = 0;
  for (let i = 0; i < value.length; i++) if (value.charCodeAt(i) === 0) n++;
  return n;
}
