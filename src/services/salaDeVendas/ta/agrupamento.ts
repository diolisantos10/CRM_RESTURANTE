/**
 * O AGRUPAMENTO DO TURNO — três mensagens do lead viram UMA resposta.
 *
 * ── COMO GENTE ESCREVE NO WHATSAPP, E COMO O TA LIA ─────────────────────────
 *
 * Ninguém escreve um parágrafo. Escreve assim:
 *
 *     19:04:02  "é padaria"
 *     19:04:07  "só vendo pelo iFood"
 *     19:04:11  "o movimento tá fraco"
 *
 * Até 10/09/2026 cada uma dessas linhas disparava um turno próprio. Três turnos,
 * três leituras do histórico — cada uma sem as mensagens que ainda estavam
 * gravando — e três composições. Na conversa real de 09/09 saíram **duas**
 * respostas, e fora de ordem.
 *
 * ── A JANELA, E POR QUE ELA É CURTA ─────────────────────────────────────────
 *
 * A correção tem duas metades. A trava (`travaDaConversa.ts`) garante que só um
 * turno corre. Esta janela garante que esse turno **espera o resto da frase**
 * antes de responder.
 *
 * Curta de propósito: quem está no WhatsApp espera resposta em segundos, e uma
 * janela longa faz o agente parecer travado. Quatro segundos pegam a rajada
 * típica de quem digita em três linhas e não pegam quem parou para pensar — e
 * quem parou para pensar é atendido pela volta seguinte do laço, não perdido.
 *
 * ── ⚠️ O QUE ESTE ARQUIVO NÃO FAZ ───────────────────────────────────────────
 *
 * Não decide o que responder, não chama modelo e não envia. Ele só responde a
 * uma pergunta: **quais mensagens de entrada este turno tem de responder?**
 */

import type { PrismaClient, Prisma } from "@prisma/client";

type Cliente = PrismaClient | Prisma.TransactionClient;

/**
 * Quanto o turno espera antes de compor, para juntar a rajada.
 *
 * `FOOCCI_SDR_JANELA_AGRUPAMENTO_MS` ajusta, dentro de limites. Zero é aceito e
 * significa "não espera" — é o que os testes usam para não dormir de verdade.
 */
export const JANELA_PADRAO_MS = 4_000;
const JANELA_MAXIMA_MS = 15_000;

export function janelaDeAgrupamento(env: NodeJS.ProcessEnv = process.env): number {
  const bruto = (env.FOOCCI_SDR_JANELA_AGRUPAMENTO_MS ?? "").trim();
  // ⚠️ VAZIO NÃO É ZERO. `Number("")` é `0`, e `0` é um inteiro válido aqui —
  // então a ausência da variável desligaria o agrupamento em silêncio, que é
  // exatamente o defeito que este arquivo existe para consertar.
  if (bruto === "") return JANELA_PADRAO_MS;
  const n = Number(bruto);
  if (!Number.isInteger(n) || n < 0) return JANELA_PADRAO_MS;
  return Math.min(n, JANELA_MAXIMA_MS);
}

/** Dorme. Isolado numa função para o teste poder substituir sem esperar. */
export function esperar(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((r) => setTimeout(r, ms));
}

export interface EntradasDoTurno {
  /** O texto consolidado, na ordem em que ele escreveu. */
  texto: string;
  /** As mensagens que compõem este turno. */
  ids: string[];
  /** A hora da última delas — o marco para saber se chegou algo depois. */
  ateQuando: Date;
}

/**
 * ⭐ JUNTA AS MENSAGENS QUE AINDA NÃO FORAM RESPONDIDAS.
 *
 * ── A REGRA, E POR QUE ELA É "DESDE A ÚLTIMA SAÍDA" ─────────────────────────
 *
 * O corte não é por tempo, é por conversa: tudo o que o lead escreveu **depois
 * da última vez que a empresa falou** é o turno atual. Um corte por janela de
 * tempo perderia a mensagem que ele mandou dois minutos antes e que ninguém
 * respondeu porque o processo caiu; o corte por última saída não perde nada.
 *
 * Devolve `null` quando não há entrada pendente — o caso normal de um turno
 * vizinho que já consolidou tudo enquanto este esperava a janela. **`null` não
 * é falha**: é a confirmação de que ninguém está sem resposta.
 */
export async function juntarEntradasDoTurno(
  db: Cliente,
  leadId: string,
  limite = 12,
): Promise<EntradasDoTurno | null> {
  const ultimaSaida = await db.leadMensagem.findFirst({
    where: { leadId, direcao: "SAIDA" },
    orderBy: { ocorreuEm: "desc" },
    select: { ocorreuEm: true },
  });

  const entradas = await db.leadMensagem.findMany({
    where: {
      leadId,
      direcao: "ENTRADA",
      ...(ultimaSaida ? { ocorreuEm: { gt: ultimaSaida.ocorreuEm } } : {}),
    },
    // Ascendente: a ordem da conversa é a do relógio do provedor, não a da
    // gravação. Ordenar por `createdAt` embaralharia uma reentrega da Meta.
    orderBy: { ocorreuEm: "asc" },
    take: limite,
    select: { id: true, texto: true, legenda: true, ocorreuEm: true },
  });

  if (entradas.length === 0) return null;

  const pedacos = entradas
    .map((m) => (m.texto ?? m.legenda ?? "").trim())
    .filter((t) => t !== "");

  if (pedacos.length === 0) return null;

  return {
    texto: juntarTextos(pedacos),
    ids: entradas.map((m) => m.id),
    ateQuando: entradas[entradas.length - 1]!.ocorreuEm,
  };
}

/**
 * Como três linhas viram um texto só.
 *
 * ⚠️ Junta com quebra de linha, e **não** com espaço. "é padaria só vendo pelo
 * iFood o movimento tá fraco" é uma frase sem sentido que o modelo tentaria
 * interpretar como uma coisa só; em três linhas ele lê três fatos, que é o que
 * são. Pontuação não é acrescentada: inventar ponto final é reescrever o que a
 * pessoa disse.
 */
export function juntarTextos(pedacos: string[]): string {
  return pedacos.join("\n");
}

/** Chegou mensagem nova do lead depois deste marco? */
export async function chegouEntradaDepois(
  db: Cliente,
  leadId: string,
  marco: Date,
): Promise<boolean> {
  const n = await db.leadMensagem.count({
    where: { leadId, direcao: "ENTRADA", ocorreuEm: { gt: marco } },
  });
  return n > 0;
}

/**
 * Carimba as entradas com o turno que as respondeu.
 *
 * É o que torna o defeito consultável: duas SAÍDAS com o mesmo `turnoId` são,
 * por definição, resposta dupla. Sem o carimbo, provar que a correção pegou
 * dependeria de alguém olhar a conversa a olho.
 *
 * Nunca lança: um carimbo perdido não pode custar a resposta ao cliente.
 */
export async function carimbarTurno(
  db: Cliente,
  ids: string[],
  turnoId: string,
): Promise<void> {
  if (ids.length === 0) return;
  try {
    await db.leadMensagem.updateMany({ where: { id: { in: ids } }, data: { turnoId } });
  } catch (e) {
    console.error(`[turno] não consegui carimbar as entradas do turno ${turnoId}:`, e);
  }
}

/**
 * ⛔ ENTIDADES HTML NÃO SAEM DAQUI.
 *
 * A conversa de 09/09 entregou `&#x20;` ao lead, literalmente. Vem do modelo,
 * que aprendeu a escapar caracteres em contexto de HTML e não sabe que aqui é
 * WhatsApp — onde `&#x20;` é só isso: cinco caracteres estranhos no meio da
 * frase, que fazem a mensagem parecer defeito porque é.
 *
 * Converte as entidades comuns e as numéricas. O que não reconhece, deixa —
 * apagar um `&` legítimo estragaria "Bar & Grill".
 */
export function limparEntidades(texto: string): string {
  return texto
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) => codigoParaTexto(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => codigoParaTexto(parseInt(dec, 10)))
    .replace(/&nbsp;/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    // ⚠️ `&amp;` por último, e sempre por último: feito antes, ele
    // transformaria `&amp;lt;` em `<` — desfazendo duas camadas de escape em
    // vez de uma, e mudando o que a pessoa escreveu.
    .replace(/&amp;/g, "&");
}

function codigoParaTexto(codigo: number): string {
  // Fora da faixa válida do Unicode, `fromCodePoint` lança. Um texto malformado
  // não pode derrubar o envio: devolve-se o que não se soube converter.
  if (!Number.isFinite(codigo) || codigo < 0 || codigo > 0x10ffff) return "";
  try {
    return String.fromCodePoint(codigo);
  } catch {
    return "";
  }
}
