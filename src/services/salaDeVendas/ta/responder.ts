/**
 * O QUE O TA RESPONDE — a boca que faltava.
 *
 * ── POR QUE ELE É DETERMINÍSTICO, E NÃO UMA CHAMADA DE MODELO ───────────────
 *
 * Lei 2 desta casa: *IA dá pensamento, não poder*. Sem provedor configurado, o
 * caminho **degrada para rule-based determinístico e nunca derruba**.
 *
 * Aqui eu inverti a ordem de construção de propósito: o rule-based vem
 * PRIMEIRO e é o produto, não o fallback. Três motivos, e nenhum é preguiça:
 *
 *   1. **Dá para ver funcionando hoje.** O CEO pediu para ver o SDR trabalhando.
 *      Um caminho que depende de chave de API que ninguém colou ainda é um
 *      caminho que ele não vê.
 *   2. **Dá para testar a fala inteira.** Cada resposta abaixo tem um teste que
 *      afirma exatamente o que sai. Com modelo no meio, o que se testa é o
 *      prompt — e prompt não é trava.
 *   3. **Ele não pode inventar.** Toda frase que chega ao lead ou veio da base
 *      de verdade ou veio da ficha. Não existe terceira origem, e isso é uma
 *      propriedade do desenho, não uma instrução.
 *
 * Quando houver provedor, ele entra REDIGINDO o que este arquivo decidiu — os
 * itens de verdade recuperados, a pergunta escolhida, o gatilho de handoff — e
 * não escolhendo o conteúdo. A trava continua aqui.
 *
 * ── O QUE ELE NUNCA FAZ ─────────────────────────────────────────────────────
 *
 * Não envia. Devolve o que DIRIA. Quem entrega é `conversa.registrarSaida`, e
 * ela só sai com `FOOCCI_SDR_SEND_ENABLED` ligada.
 */

import { buscarNaVerdade, type Achado } from "./verdade";
import { VERSAO_1, QUANDO_NAO_SEI, type TextoDaVersao } from "./ficha";
import { gatilhosQueDispararam, type SinaisDaConversa } from "../handoff";
import type { MotivoDoHandoff } from "@prisma/client";

export interface Turno {
  /** O que o lead escreveu agora. */
  mensagem: string;
  /** Quais perguntas da sondagem já foram feitas (por índice). */
  jaPerguntou?: number[];
  /** O nome dele, quando já se sabe. */
  nome?: string | null;
  /** Sinais que a Sala já apurou — score, confiança, risco. */
  sinais?: SinaisDaConversa;
  /**
   * Os turnos anteriores, do mais antigo para o mais novo.
   *
   * Ignorado pelo caminho determinístico — ele responde uma pergunta por vez, e
   * sempre respondeu. Existe aqui porque `falar()` passa o mesmo `Turno` para o
   * modelo, e é o histórico que separa uma conversa de uma sequência de
   * respostas soltas: sem ele, o TA cumprimenta a mesma pessoa três vezes.
   */
  historico?: Array<{ deQuem: "cliente" | "ta"; texto: string }>;
}

export interface Resposta {
  /** O que ele diria. Nunca vazio. */
  texto: string;
  /** Em que a resposta se apoia. Vazio = ele não afirmou nada. */
  apoiadoEm: Array<{ id: string; fonte: string }>;
  /** A pergunta da sondagem que ele fez neste turno, se fez. */
  perguntouIndice: number | null;
  /** Quando é hora de chamar gente, e por quê. */
  handoff: { deve: boolean; motivo: MotivoDoHandoff | null };
  /** Por que a resposta saiu assim — para a tela de ensaio mostrar. */
  porque: string;
}

/**
 * Sinais que se leem do TEXTO, sem modelo nenhum.
 *
 * Lista curta e literal de propósito: cada expressão aqui é uma que aparece na
 * conversa real de restaurante. Uma lista maior pareceria mais esperta e
 * dispararia handoff em conversa tranquila — e handoff que dispara à toa é o
 * jeito mais rápido de o time desligar o TA.
 */
const PEDE_GENTE = /\b(falar com (uma pessoa|algu[ée]m|humano|atendente)|quero falar com|me liga|liga pra mim|chama algu[ée]m)\b/i;
const PEDE_PROPOSTA = /\b(proposta|or[çc]amento|contrato|manda(r)? por escrito)\b/i;
const PEDE_DESCONTO = /\b(desconto|mais barato|melhor pre[çc]o|consegue fazer por|abate)\b/i;
const INSATISFEITO = /\b(p[ée]ssimo|horr[íi]vel|absurdo|golpe|enrola[çc][ãa]o|palha[çc]ada)\b/i;

export function lerSinaisDoTexto(mensagem: string): SinaisDaConversa {
  return {
    pediuHumano: PEDE_GENTE.test(mensagem),
    pediuProposta: PEDE_PROPOSTA.test(mensagem),
    pediuDesconto: PEDE_DESCONTO.test(mensagem),
    sentimentoNegativo: INSATISFEITO.test(mensagem),
  };
}

/**
 * A saudação do primeiro contato. Uma vez só, e curta.
 *
 * ── ⛔ POR QUE "TA" SAIU DAQUI, EM 07/09/2026 ───────────────────────────────
 *
 * A saudação era *"Aqui é o TA, do Foocci."* — e "TA" é sigla interna que **o
 * código nunca define em lugar nenhum**. Quem provou o defeito foi o próprio
 * CEO, perguntando *"o que é TA?"*. Se o dono da empresa não sabe, o dono do
 * restaurante também não vai saber: é vocabulário nosso vazando para o cliente
 * — exatamente o que o bloco "O QUE NUNCA APARECE NA SUA FALA" proíbe em
 * `oficio.ts`. A saudação violava a regra do arquivo ao lado.
 *
 * ── E POR QUE ELE DIZ QUE É AGENTE, LOGO NA PRIMEIRA FRASE ─────────────────
 *
 * Decisão do CEO na mesma conversa: *"não precisa enganar alguém... é só falar
 * que é agente de atendimento do Foocci e seguir com a abordagem."*
 *
 * Dito **uma vez**, na abertura, e nunca mais. Repetir em toda mensagem seria
 * robótico; esconder seria enganar. A pessoa fica sabendo com quem fala e a
 * conversa segue.
 */
function abertura(nome?: string | null): string {
  return nome
    ? `Oi, ${nome.split(" ")[0]}! Aqui é o agente de atendimento do Foocci.`
    : "Oi! Aqui é o agente de atendimento do Foocci.";
}

/**
 * A próxima pergunta da sondagem — na ordem publicada da ficha.
 *
 * Uma por turno. Duas perguntas na mesma mensagem é o erro que faz o dono de
 * restaurante responder só a última e a sondagem ficar com buraco.
 */
function proximaPergunta(
  jaPerguntou: number[],
  ficha: TextoDaVersao,
): { indice: number; texto: string } | null {
  const feito = new Set(jaPerguntou);
  for (let i = 0; i < ficha.perguntas.length; i++) {
    if (!feito.has(i)) return { indice: i, texto: ficha.perguntas[i]! };
  }
  return null;
}

/** No máximo dois apoios: três viram parede de texto no WhatsApp. */
const MAXIMO_DE_APOIOS = 2;

/**
 * O segundo apoio só entra se for quase tão bom quanto o primeiro.
 *
 * ── ACHADO DO PRIMEIRO ENSAIO (25/08/2026) ─────────────────────────────────
 *
 * Perguntado "quanto custa o plano Crescimento?", o TA respondeu com o preço do
 * Crescimento **e o do Essencial**, porque os dois passaram do piso e ele pegava
 * os dois melhores. Quem pergunta de um plano recebia dois — e o segundo parece
 * empurrão de vendedor, que é exatamente o tom que a ficha proíbe.
 *
 * Quando o primeiro item é decisivo, o segundo não acrescenta: atrapalha.
 */
const PROXIMIDADE_DO_SEGUNDO = 0.8;

function apoiosQueValem(achados: Achado[]): Achado[] {
  if (achados.length === 0) return [];
  const melhor = achados[0]!;
  return achados
    .slice(0, MAXIMO_DE_APOIOS)
    .filter((a, i) => i === 0 || a.cobertura >= melhor.cobertura * PROXIMIDADE_DO_SEGUNDO);
}

/**
 * O turno do TA.
 *
 * A ordem das decisões é o desenho:
 *
 *   1. **Handoff primeiro.** Se o lead pediu gente, nada mais importa — nem
 *      responder o que ele perguntou antes. Ignorar um pedido explícito é o
 *      pior defeito possível numa conversa de venda.
 *   2. **Depois o que ele perguntou**, com o que a base tiver.
 *   3. **Só então a sondagem.** Perguntar antes de responder é o que faz a
 *      pessoa sentir que está preenchendo formulário.
 */
export function responder(turno: Turno, ficha: TextoDaVersao = VERSAO_1): Resposta {
  const primeiroContato = (turno.jaPerguntou ?? []).length === 0;

  const sinais: SinaisDaConversa = {
    ...lerSinaisDoTexto(turno.mensagem),
    ...turno.sinais,
  };
  const disparados = gatilhosQueDispararam(sinais, {
    scoreParaHumano: 70,
    confiancaMinima: 0.6,
    ligados: ficha.gatilhos,
  });

  // ── 1. Pediu gente, ou é caso de gente ──────────────────────────────────
  if (disparados.length > 0) {
    const motivo = disparados[0]!;
    return {
      texto:
        `${primeiroContato ? abertura(turno.nome) + " " : ""}` +
        "Perfeito — vou chamar alguém do time para falar com você agora. " +
        "Já deixei aqui o que você me contou.",
      apoiadoEm: [],
      perguntouIndice: null,
      handoff: { deve: true, motivo },
      porque: `gatilho ${motivo} disparou no texto do lead`,
    };
  }

  // ── 2. Responder o que ele perguntou ────────────────────────────────────
  const achados: Achado[] = buscarNaVerdade(turno.mensagem);
  const usados = apoiosQueValem(achados);

  const partes: string[] = [];
  if (primeiroContato) partes.push(abertura(turno.nome));

  if (usados.length > 0) {
    partes.push(usados.map((a) => a.item.texto).join(" "));
  } else if (pareceUmaPergunta(turno.mensagem)) {
    // Perguntou e a base não tem. Aqui é o momento em que um agente sem trava
    // inventaria — e este devolve o limite e chama gente.
    return {
      texto: `${primeiroContato ? abertura(turno.nome) + " " : ""}${QUANDO_NAO_SEI}`,
      apoiadoEm: [],
      perguntouIndice: null,
      handoff: { deve: true, motivo: "INFORMACAO_NAO_CONFIRMADA" },
      porque: "a base de verdade não cobriu a pergunta — e ele não chuta",
    };
  }

  // ── 3. A sondagem, uma pergunta ─────────────────────────────────────────
  const pergunta = proximaPergunta(turno.jaPerguntou ?? [], ficha);
  if (pergunta) partes.push(pergunta.texto);

  return {
    texto: partes.join(" ").trim(),
    apoiadoEm: usados.map((a) => ({ id: a.item.id, fonte: a.item.fonte })),
    perguntouIndice: pergunta?.indice ?? null,
    handoff: { deve: false, motivo: null },
    porque:
      usados.length > 0
        ? `respondeu com ${usados.length} item(ns) da base e seguiu a sondagem`
        : "nada a responder ainda — seguiu a sondagem",
  };
}

/**
 * A mensagem é uma pergunta?
 *
 * Sem isto, "bom dia" cairia no ramo do "não sei" e o TA abriria a conversa
 * dizendo que não sabe — que é o pior primeiro contato possível.
 */
export function pareceUmaPergunta(mensagem: string): boolean {
  if (mensagem.includes("?")) return true;
  // `integra[a-z]*` e não `integra`: o `\b` do fim exige fronteira de palavra, e
  // "integram" — que é como a pessoa escreve de verdade — não tem fronteira
  // depois de "integra". O teste pegou isto.
  return /\b(quanto|qual|quais|como|onde|quando|por que|porque|tem|voc[êe]s? (fazem|t[êe]m|integra[a-z]*))\b/i.test(
    mensagem,
  );
}
