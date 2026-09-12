/**
 * O AGENDADOR DA RODADA DAS 9h — dentro do processo, medido, e com reserva.
 *
 * ── POR QUE ELE EXISTE, com os números ──────────────────────────────────────
 *
 * A rodada das 9h nasceu (#218–#229) presa ao cron do GitHub Actions
 * (`prospeccao-rodada.yml`, `0 12 * * 1-5`). Medido:
 *
 *   · 09/09/2026 — disparou às 15:43 UTC: **3h43 de atraso**;
 *   · 10/09/2026 — **não disparou**.
 *
 * O cron do GitHub é "melhor esforço" por contrato e atrasa quando a fila deles
 * está cheia — exatamente às 9h de segunda a sexta. Uma operação comercial que
 * promete abordar de manhã não pode depender disso.
 *
 * Este agendador roda no próprio servidor (Railway), no padrão dos outros dois
 * da casa (`CartRecoveryScheduler`, `ScheduledCampaignScheduler`), ligado em
 * `src/instrumentation.ts`. Ele confere a cada minuto e dispara **uma vez por
 * dia útil**, na hora configurada (9h de São Paulo).
 *
 * ── A RESERVA, e por que ela é atômica ──────────────────────────────────────
 *
 * Com o GitHub continuando como reserva, existem DOIS agendadores para a mesma
 * rodada. Sem uma trava no banco, o atrasado dispara por cima do pontual e o
 * dia manda o dobro. A reserva é um `updateMany` condicional em
 * `prospeccao_config` — *"se a última rodada automática foi antes de hoje,
 * carimbe agora"* — e só quem carimbou (count = 1) roda. Não é "ler e depois
 * escrever": é uma instrução só, e o Postgres decide quem ganhou.
 *
 * ⚠️ Só a rodada AUTOMÁTICA reserva. `workflow_dispatch` com teto (alguém
 * mandando dez à mão) e o botão da tela não passam por aqui: o teto do dia,
 * contado no banco, já é o freio deles.
 *
 * ── O QUE ELE NÃO AFROUXA ───────────────────────────────────────────────────
 *
 * Nada. Ele chama `abordarARodadaDoDia` com o MESMO pré-voo e o MESMO
 * `canalPronto` da rota de cron. Interruptor da prospecção desligado → fila
 * vazia → zero abordados, com o motivo no log. Disparar na hora certa não é
 * disparar sem permissão: a permissão continua sendo o interruptor, que é a
 * mão do "vai" do CEO (ordem do Diretor Geral, 10/09/2026).
 *
 * ── MEDIÇÃO ─────────────────────────────────────────────────────────────────
 *
 * Toda decisão vira log com o caso concreto (guardrail 6): "reservou e rodou",
 * "já rodou hoje por X às Y", "fora da hora", "sem configuração". E o carimbo
 * (`ultimaRodadaAutomaticaEm/Por`) sai no raio-x do pré-voo — dá para saber
 * de fora se a rodada de hoje aconteceu, sem abrir log nenhum.
 */

import type { PrismaClient, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { REGRA, agendaLocal } from "@/services/foocci-sdr/LeadContactSafety";
import { inicioDoDiaEmSaoPaulo } from "./selecao";
import { abordarARodadaDoDia, type ResultadoDaRodada } from "./abordarDaFila";
import { canalDeVendasPronto } from "@/services/foocci-sdr/FoocciSalesChannel";
import { preVooDoModelo } from "@/services/foocci-sdr/modelosDaMeta";

type Cliente = PrismaClient | Prisma.TransactionClient;

/** A cada minuto: barato (uma leitura de relógio) e preciso o bastante. */
const INTERVALO_MS = 60_000;

/**
 * Hora do dia (São Paulo) em que a rodada automática dispara. 9h por padrão —
 * o horário que o CEO nomeou ("a rodada das 9h"). `FOOCCI_PROSPECCAO_HORA`
 * troca sem deploy; fora de 0–23 vale o padrão, nunca "nunca".
 */
export function horaDaRodada(env: NodeJS.ProcessEnv = process.env): number {
  const n = parseInt((env.FOOCCI_PROSPECCAO_HORA ?? "").trim(), 10);
  return Number.isInteger(n) && n >= 0 && n <= 23 ? n : 9;
}

/**
 * É agora? Dia útil, e a hora local de São Paulo é a da rodada.
 *
 * Não confere o minuto de propósito: se o processo reiniciou às 9h00m30s (um
 * deploy, por exemplo), o tick das 9h01 ainda é "agora". Quem impede dois
 * disparos na mesma manhã é a reserva, não o relógio.
 */
export function ehHoraDaRodada(agora: Date, hora: number = horaDaRodada()): boolean {
  const local = agendaLocal(agora, REGRA.fusoHorario);
  if (!(REGRA.diasUteis as readonly number[]).includes(local.dia)) return false;
  return local.hora === hora;
}

/**
 * ⭐ A PRÓXIMA EXECUÇÃO — para a tela mostrar "quando" sem reimplementar a
 * regra do agendador. Redesenho da prospecção automática e minimalista,
 * 12/09/2026 (bloco Operação: "Próxima execução: data e horário").
 *
 * Não é uma segunda régua de horário: é `horaDaRodada()` e `REGRA.diasUteis`
 * (as MESMAS que `ehHoraDaRodada` usa) andando para a frente até achar o
 * primeiro dia útil, na hora configurada, ainda no futuro. Não confere se a
 * rodada de hoje já rodou — quem quer saber isso lê
 * `ultimaRodadaAutomaticaEm`, que a tela já tem ao lado.
 */
export function proximaExecucaoDaRodada(agora: Date, hora: number = horaDaRodada()): Date {
  for (let i = 0; i < 8; i++) {
    const candidato = new Date(agora.getTime() + i * 24 * 60 * 60 * 1000);
    const local = agendaLocal(candidato, REGRA.fusoHorario);
    if (!(REGRA.diasUteis as readonly number[]).includes(local.dia)) continue;

    const meiaNoite = inicioDoDiaEmSaoPaulo(candidato);
    const alvo = new Date(meiaNoite.getTime() + hora * 60 * 60 * 1000);
    if (alvo.getTime() > agora.getTime()) return alvo;
  }
  // Nunca deveria chegar aqui — oito dias sempre contêm um dia útil. Devolver
  // "agora" é mais honesto que lançar: a tela mostra uma data no passado, o
  // que é estranho e visível, em vez de quebrar a página inteira.
  return agora;
}

export type Reserva =
  | { reservou: true }
  | { reservou: false; motivo: "jaRodouHoje" | "semConfiguracao"; detalhe: string };

/**
 * ⭐ A reserva atômica da rodada automática de hoje.
 *
 * `updateMany` com a condição dentro do `where`: ou a última rodada automática
 * é nula, ou é anterior à meia-noite de São Paulo de hoje. Quem devolve
 * `count: 1` ganhou; quem devolve `0` chegou depois — ou não há configuração,
 * e sem configuração a prospecção está desligada de qualquer forma.
 */
export async function reservarRodadaAutomaticaDoDia(
  db: Cliente,
  agora: Date,
  quem: string,
): Promise<Reserva> {
  const inicioDoDia = inicioDoDiaEmSaoPaulo(agora);

  const r = await db.prospeccaoConfig.updateMany({
    where: {
      id: "singleton",
      OR: [{ ultimaRodadaAutomaticaEm: null }, { ultimaRodadaAutomaticaEm: { lt: inicioDoDia } }],
    },
    data: { ultimaRodadaAutomaticaEm: agora, ultimaRodadaAutomaticaPor: quem },
  });

  if (r.count === 1) return { reservou: true };

  const atual = await db.prospeccaoConfig.findUnique({
    where: { id: "singleton" },
    select: { ultimaRodadaAutomaticaEm: true, ultimaRodadaAutomaticaPor: true },
  });

  if (!atual) {
    return {
      reservou: false,
      motivo: "semConfiguracao",
      detalhe: "prospeccao_config não existe — a prospecção nunca foi ligada",
    };
  }

  return {
    reservou: false,
    motivo: "jaRodouHoje",
    detalhe:
      `a rodada automática de hoje já foi reservada por ${atual.ultimaRodadaAutomaticaPor ?? "?"}` +
      ` às ${atual.ultimaRodadaAutomaticaEm?.toISOString() ?? "?"}`,
  };
}

/** Quantos itens saíram por cada motivo — o mesmo resumo da rota de cron. */
export function resumoDaRodada(r: ResultadoDaRodada): Record<string, unknown> {
  const porMotivo: Record<string, number> = {};
  const exemplo: Record<string, string> = {};
  for (const linha of r.extrato) {
    const chave = linha.ok ? "ok" : linha.motivo ?? "(sem motivo)";
    porMotivo[chave] = (porMotivo[chave] ?? 0) + 1;
    if (!linha.ok && linha.motivo && linha.detalhe && exemplo[linha.motivo] === undefined) {
      exemplo[linha.motivo] = linha.detalhe;
    }
  }
  return {
    abordados: r.abordados,
    pulados: r.pulados,
    parouPor: r.parouPor,
    falha: r.falha,
    porMotivo,
    exemploPorMotivo: exemplo,
  };
}

export interface UltimoTick {
  em: string;
  decisao: "rodou" | "jaRodouHoje" | "semConfiguracao" | "foraDaHora" | "quebrou";
  detalhe?: string;
  rodada?: ReturnType<typeof resumoDaRodada>;
}

export class AgendadorDaProspeccao {
  private static handle: ReturnType<typeof setInterval> | null = null;
  private static rodando = false;
  private static ultimo: UltimoTick | null = null;

  static estaAtivo(): boolean {
    return this.handle !== null;
  }

  static ultimoTick(): UltimoTick | null {
    return this.ultimo;
  }

  static start(): void {
    if (this.handle !== null) return;
    if (process.env.NODE_ENV !== "production") {
      console.log("[AgendadorDaProspeccao] não ligado — NODE_ENV não é 'production'", {
        NODE_ENV: process.env.NODE_ENV,
      });
      return;
    }
    console.log("[AgendadorDaProspeccao] ligado", {
      horaDaRodada: horaDaRodada(),
      fuso: REGRA.fusoHorario,
      intervaloMs: INTERVALO_MS,
    });
    this.handle = setInterval(() => void this.tick(), INTERVALO_MS);
  }

  static stop(): void {
    if (this.handle !== null) {
      clearInterval(this.handle);
      this.handle = null;
    }
  }

  /**
   * Um tick. Exposto para teste, com as dependências injetáveis: o relógio, o
   * banco e a rodada — para provar a reserva sem falar com a Meta nem com
   * ninguém.
   */
  static async tick(
    deps: {
      agora?: Date;
      db?: Cliente;
      rodada?: typeof abordarARodadaDoDia;
      hora?: number;
    } = {},
  ): Promise<UltimoTick> {
    const agora = deps.agora ?? new Date();
    const db = deps.db ?? prisma;
    const rodada = deps.rodada ?? abordarARodadaDoDia;

    if (this.rodando) {
      return { em: agora.toISOString(), decisao: "foraDaHora", detalhe: "tick anterior ainda rodando" };
    }
    if (!ehHoraDaRodada(agora, deps.hora)) {
      return (this.ultimo = { em: agora.toISOString(), decisao: "foraDaHora" });
    }

    this.rodando = true;
    try {
      const reserva = await reservarRodadaAutomaticaDoDia(db, agora, "agendador interno");
      if (!reserva.reservou) {
        console.info(`[AgendadorDaProspeccao] não rodou — ${reserva.detalhe}`);
        return (this.ultimo = { em: agora.toISOString(), decisao: reserva.motivo, detalhe: reserva.detalhe });
      }

      console.info("[AgendadorDaProspeccao] ⭐ reservou a rodada automática de hoje — rodando");
      const r = await rodada(db, {
        autor: "SISTEMA",
        canalPronto: canalDeVendasPronto(),
        preVoo: preVooDoModelo,
        agora,
      });
      const resumo = resumoDaRodada(r);
      console.info("[AgendadorDaProspeccao] rodada concluída", resumo);
      return (this.ultimo = { em: agora.toISOString(), decisao: "rodou", rodada: resumo });
    } catch (e) {
      // A reserva já está carimbada: a rodada de hoje não volta sozinha. O log
      // carrega o erro para alguém disparar à mão — melhor que rodar duas vezes.
      const detalhe = e instanceof Error ? e.message : String(e);
      console.error("[AgendadorDaProspeccao] o tick quebrou DEPOIS da reserva — a rodada de hoje precisa de disparo manual", { detalhe });
      return (this.ultimo = { em: agora.toISOString(), decisao: "quebrou", detalhe });
    } finally {
      this.rodando = false;
    }
  }
}
