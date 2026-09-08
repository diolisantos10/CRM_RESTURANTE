/**
 * O ÚLTIMO ELO — da fila de prospecção para a mensagem que sai.
 *
 * ── O QUE ESTAVA FALTANDO ───────────────────────────────────────────────────
 *
 * A casa tinha as duas pontas e nenhum fio entre elas:
 *
 *   · `materializarLead` transforma um item da lista em lead — e **não tinha um
 *     único chamador em produção**;
 *   · `abordarLead` manda a mensagem — e só sabia partir de um lead que já
 *     existisse.
 *
 * Este arquivo é o fio. Nada mais.
 *
 * ── ⚠️ POR QUE O FREIO É CONSULTADO AQUI, ANTES DE MATERIALIZAR ────────────
 *
 * `abordarLead` já confere o ritmo — mas ele confere DEPOIS que o lead existe.
 * Materializar primeiro e descobrir o teto depois deixaria um lead criado que
 * ninguém abordou: uma ficha órfã na base, nascida de uma tentativa que não
 * aconteceu. Multiplicado por uma lista grande, isso enche a carteira de gente
 * com quem a empresa nunca falou.
 *
 * A conferência dupla custa uma consulta e evita esse lixo. É repetição com
 * motivo, e está escrito qual é.
 */

import type { PrismaClient, Prisma } from "@prisma/client";
import { materializarLead } from "./selecao";
import { abordarLead, type ResultadoDaAbordagem } from "../abordar";
import { conferirRitmo } from "../freioDeRitmo";
import { montarFilaDeProspeccao } from "./selecao";

type Cliente = PrismaClient | Prisma.TransactionClient;

/** Os motivos de `abordarLead`, sem repetir a lista à mão. */
type MotivoDaAbordagem = Extract<ResultadoDaAbordagem, { abordou: false }>["motivo"];

export type ResultadoDaFila =
  | { abordou: true; leadId: string; mensagemId: string }
  | {
      abordou: false;
      /** `naoVirouLead` = o item nem chegou a ser lead (lote não liberado, já usado…). */
      motivo: "naoVirouLead" | MotivoDaAbordagem;
      detalhe: string;
    };

export async function abordarItemDaFila(
  db: Cliente,
  params: { itemId: string; autorUserId: string; agora?: Date },
): Promise<ResultadoDaFila> {
  const agora = params.agora ?? new Date();

  // ⚠️ ANTES de materializar. Ver o cabeçalho.
  const ritmo = await conferirRitmo(db, agora);
  if (!ritmo.pode) {
    return { abordou: false, motivo: "ritmo", detalhe: ritmo.detalhe };
  }

  const m = await materializarLead(db, params.itemId);
  if (!m.materializado) {
    return { abordou: false, motivo: "naoVirouLead", detalhe: m.motivo };
  }

  const r = await abordarLead(db, {
    leadId: m.leadId,
    autorUserId: params.autorUserId,
    agora,
  });

  if (r.abordou) {
    return { abordou: true, leadId: m.leadId, mensagemId: r.mensagemId };
  }

  // O motivo de `abordarLead` sobe inteiro. Traduzir aqui faria a tela mostrar
  // uma explicação que o serviço não deu.
  return { abordou: false, motivo: r.motivo, detalhe: r.detalhe };
}

// ─── A RODADA DO DIA ──────────────────────────────────────────────────────────

/**
 * Aborda a fila inteira de uma vez, e PARA na primeira falha de verdade.
 *
 * ── POR QUE ISTO PRECISOU EXISTIR ───────────────────────────────────────────
 *
 * `abordarItemDaFila` aborda **um** item, e a rota só sabia acioná-lo um por
 * chamada. Medido em 08/09/2026: não existe cron de prospecção — nenhuma das 17
 * pastas de `api/cron` é da Sala. Ou seja, os "250 por dia" que o CEO pediu
 * eram, na prática, **250 acionamentos manuais**.
 *
 * Esta função é o laço, e nada além do laço. Ela não decide quem entra (é a
 * fila), não confere teto (a fila já conta o dia no banco), não fala com a Meta
 * (é `abordarLead`) e não afrouxa portão nenhum: cada item passa exatamente
 * pelas mesmas travas de quando era clicado à mão.
 *
 * ── ⛔ PARAR NA PRIMEIRA FALHA É A REGRA, E ELA É DO DIRETOR GERAL ──────────
 *
 * *"Se o primeiro envio falhar, PARE a rodada e investigue. Não empurre 250 em
 * cima de um defeito — é assim que se queima uma lista de 4.000 num dia."*
 *
 * Por isso a rodada é **sequencial** e não paralela: o resultado do primeiro
 * envio é o que autoriza o segundo. Paralelizar seria trocar o freio por
 * velocidade num lugar onde o erro custa a lista inteira.
 *
 * ── O QUE **NÃO** É FALHA, e a distinção decide a rodada ────────────────────
 *
 * Item barrado por regra — quem pediu silêncio, quem está fora da janela, quem
 * já foi abordado há pouco — **não é defeito**: é o portão fazendo o trabalho
 * dele. Parar a rodada por isso deixaria um opt-out no topo da lista bloqueando
 * os outros 249. Esses são pulados, contados, e a rodada segue.
 *
 * Falha é o que indica que **o caminho está quebrado**: a mensagem não saiu por
 * razão nossa — canal, credencial, modelo, banco. Aí para.
 */

/**
 * O que fazer diante de cada motivo — e a lista é EXAUSTIVA de propósito.
 *
 * ⚠️ A primeira versão desta função trazia um `Set` com nomes que eu escrevi de
 * cabeça — `pediuSilencio`, `foraDaJanela`, `jaAbordado`, `semConsentimento`,
 * `duplicado`. **Nenhum deles existe.** Os motivos reais são os cinco de
 * `ResultadoDaAbordagem` (`abordar.ts:50`) mais o `naoVirouLead` desta camada.
 * Um `Set` com nome inventado não reprova em lugar nenhum: ele simplesmente
 * nunca casa, e toda recusa viraria "falha" — a rodada morreria no primeiro
 * opt-out da lista, para sempre, e pareceria defeito do canal.
 *
 * Por isso aqui é um `switch` exaustivo com `never` no fim: **motivo novo não
 * compila** enquanto ninguém disser o que fazer com ele. É a diferença entre
 * uma lista que envelhece calada e uma que obriga a decisão.
 */
type Reacao = "pula" | "encerra" | "falha";

/** Os motivos que a fila pode devolver, sem repetir a lista à mão. */
type MotivoDaFila = Extract<ResultadoDaFila, { abordou: false }>["motivo"];

function reagirA(motivo: MotivoDaFila): Reacao {
  switch (motivo) {
    // O portão fazendo o trabalho dele. Pular um opt-out e seguir é o certo —
    // parar aqui deixaria um silêncio no topo da lista bloqueando os outros 249.
    case "naoVirouLead":
    case "portaoRecusou":
      return "pula";

    // O freio do dia/hora. Não é defeito, e não adianta tentar o próximo: ele
    // vai bater no mesmo teto. A rodada termina, satisfeita.
    case "ritmo":
      return "encerra";

    // O caminho está quebrado por razão nossa. Para, e grita.
    case "leadNaoExiste":
    case "naoConseguiuGravar":
    case "aMetaRecusou":
      return "falha";

    default: {
      const naoTratado: never = motivo;
      return naoTratado;
    }
  }
}

export interface ResultadoDaRodada {
  /** Quantas mensagens saíram. */
  abordados: number;
  /** Quantos itens o portão barrou por regra — não é defeito. */
  pulados: number;
  /** Por que a rodada terminou. `filaAcabou` e `freio` são fins normais. */
  parouPor: "filaAcabou" | "tetoDaRodada" | "freio" | "falha";
  /** Preenchido só quando `parouPor === "falha"`. */
  falha: { itemId: string; motivo: string; detalhe: string } | null;
  /** Uma linha por item tentado, na ordem. É o extrato da rodada. */
  extrato: Array<{ itemId: string; ok: boolean; motivo?: string }>;
}

export async function abordarARodadaDoDia(
  db: Cliente,
  params: {
    autorUserId: string;
    /** Teto DESTA rodada, além do teto do dia que a fila já aplica. */
    teto?: number;
    agora?: Date;
    canalPronto: boolean;
  },
): Promise<ResultadoDaRodada> {
  const agora = params.agora ?? new Date();

  const fila = await montarFilaDeProspeccao(db, {
    canalPronto: params.canalPronto,
    agora,
    // A fila já corta pelo teto do dia contado no banco; o teto da rodada é uma
    // segunda cinta, para quem quer mandar dez de um lote que permite duzentos.
    ...(params.teto !== undefined ? { limite: params.teto } : {}),
  });

  const extrato: ResultadoDaRodada["extrato"] = [];
  let abordados = 0;
  let pulados = 0;

  for (const candidato of fila.liberados) {
    if (params.teto !== undefined && abordados >= params.teto) {
      return { abordados, pulados, parouPor: "tetoDaRodada", falha: null, extrato };
    }

    const r = await abordarItemDaFila(db, {
      itemId: candidato.itemId,
      autorUserId: params.autorUserId,
      agora,
    });

    if (r.abordou) {
      abordados += 1;
      extrato.push({ itemId: candidato.itemId, ok: true });
      continue;
    }

    const reacao = reagirA(r.motivo);
    extrato.push({ itemId: candidato.itemId, ok: false, motivo: r.motivo });

    if (reacao === "pula") {
      pulados += 1;
      continue;
    }

    if (reacao === "encerra") {
      return { abordados, pulados, parouPor: "freio", falha: null, extrato };
    }

    // ⛔ Falha de verdade: o caminho está quebrado. A rodada morre aqui, e o
    // motivo sobe inteiro — quem investiga precisa do item e da razão, não de
    // "a rodada falhou".
    console.error("[prospeccao] rodada INTERROMPIDA na primeira falha", {
      itemId: candidato.itemId,
      motivo: r.motivo,
      detalhe: r.detalhe,
      jaAbordadosNestaRodada: abordados,
    });
    return {
      abordados,
      pulados,
      parouPor: "falha",
      falha: { itemId: candidato.itemId, motivo: r.motivo, detalhe: r.detalhe },
      extrato,
    };
  }

  return { abordados, pulados, parouPor: "filaAcabou", falha: null, extrato };
}
