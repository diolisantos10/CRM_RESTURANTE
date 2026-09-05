/**
 * A RODADA — o gatilho, e o que ele faz de fato.
 *
 * Monta a fila, e aborda quem ela liberou, um por um, relendo o teto a cada
 * abordagem. É o que o cron chama.
 *
 * ── POR QUE UM POR UM, E NÃO EM LOTE ────────────────────────────────────────
 *
 * Porque cada abordagem reserva o lead com uma escrita condicional e reconta o
 * teto no banco. Em lote, uma falha no meio deixaria metade reservada e metade
 * não, e nenhum contador saberia dizer qual metade. O ganho de velocidade não
 * compra nada: o teto de um dia inteiro cabe em segundos, mesmo assim.
 *
 * ── O QUE ELA DEVOLVE ───────────────────────────────────────────────────────
 *
 * A rodada devolve o que aconteceu com CADA lead, inclusive os barrados e o
 * motivo. Relatório que diz só "3 abordados" esconde os 40 que não foram e por
 * quê — e é justamente essa lista que responde "por que ninguém está sendo
 * abordado?" sem ninguém precisar abrir o banco.
 */

import type { PrismaClient } from "@prisma/client";
import { canalDeVendasPronto } from "@/services/foocci-sdr/FoocciSalesChannel";
import { montarFilaDePrimeiroContato, type FilaDePrimeiroContato } from "./fila";
import { abordarLead, type ResultadoDaAbordagem } from "./disparo";

export interface ResultadoDaRodada {
  /** Quantos receberam a mensagem de fato. */
  abordados: number;
  /** Quantos a fila liberou mas o disparo recusou (teto, corrida, recusa da Meta). */
  recusados: number;
  /** Quantos a fila já barrou antes de chegar ao disparo. */
  barrados: number;
  fila: FilaDePrimeiroContato;
  resultados: ResultadoDaAbordagem[];
}

export async function rodarPrimeiroContato(
  db: PrismaClient,
  opcoes: { agora?: Date; limite?: number } = {},
): Promise<ResultadoDaRodada> {
  const agora = opcoes.agora ?? new Date();

  const fila = await montarFilaDePrimeiroContato(db, {
    // Aqui o estado do canal é o REAL, sempre. A simulação existe só na leitura
    // da fila, para conferência — nunca no caminho que fala com alguém.
    canalPronto: canalDeVendasPronto(),
    agora,
    limite: opcoes.limite,
  });

  const resultados: ResultadoDaAbordagem[] = [];
  for (const candidato of fila.liberados) {
    resultados.push(await abordarLead(db, candidato.leadId, { agora }));
  }

  return {
    abordados: resultados.filter((r) => r.abordado).length,
    recusados: resultados.filter((r) => !r.abordado).length,
    barrados: fila.barrados.length,
    fila,
    resultados,
  };
}
