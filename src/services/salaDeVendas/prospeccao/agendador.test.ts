/**
 * O agendador interno da rodada das 9h: dispara na hora, uma vez por dia, e
 * nunca por cima do outro agendador.
 *
 * Nada aqui fala com a Meta: a rodada é um duplo. O que se prova é a decisão —
 * hora certa, reserva atômica, e o cron do GitHub atrasado sendo recusado.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/services/foocci-sdr/FoocciSalesChannel", () => ({ canalDeVendasPronto: () => true }));
vi.mock("@/services/foocci-sdr/modelosDaMeta", () => ({ preVooDoModelo: vi.fn() }));

import {
  AgendadorDaProspeccao,
  ehHoraDaRodada,
  horaDaRodada,
  reservarRodadaAutomaticaDoDia,
} from "./agendador";

// 10/09/2026 é quinta-feira. 12:00 UTC = 9h em São Paulo (UTC-3).
const QUINTA_9H_SP = new Date("2026-09-10T12:00:00Z");
const QUINTA_9H30_SP = new Date("2026-09-10T12:30:00Z");
const QUINTA_10H_SP = new Date("2026-09-10T13:00:00Z");
const SABADO_9H_SP = new Date("2026-09-12T12:00:00Z");
const SEXTA_9H_SP = new Date("2026-09-11T12:00:00Z");

const guardado = { ...process.env };
afterEach(() => {
  process.env = { ...guardado };
  AgendadorDaProspeccao.stop();
});

describe("a hora da rodada", () => {
  it("9h de São Paulo por padrão; FOOCCI_PROSPECCAO_HORA troca; lixo volta ao padrão", () => {
    expect(horaDaRodada({})).toBe(9);
    expect(horaDaRodada({ FOOCCI_PROSPECCAO_HORA: "14" })).toBe(14);
    expect(horaDaRodada({ FOOCCI_PROSPECCAO_HORA: "25" })).toBe(9);
    expect(horaDaRodada({ FOOCCI_PROSPECCAO_HORA: "manhã" })).toBe(9);
  });

  it("é hora durante os 60 minutos das 9h, em dia útil — e não fora deles", () => {
    expect(ehHoraDaRodada(QUINTA_9H_SP, 9)).toBe(true);
    expect(ehHoraDaRodada(QUINTA_9H30_SP, 9)).toBe(true);
    expect(ehHoraDaRodada(QUINTA_10H_SP, 9)).toBe(false);
    expect(ehHoraDaRodada(SABADO_9H_SP, 9)).toBe(false);
  });
});

/** Um `prospeccao_config` de mentira, com a reserva feita do jeito do Postgres. */
function bancoComConfig(inicial: { ultimaRodadaAutomaticaEm: Date | null; ultimaRodadaAutomaticaPor: string | null } | null) {
  const linha = inicial ? { ...inicial } : null;
  return {
    linha: () => linha,
    db: {
      prospeccaoConfig: {
        updateMany: vi.fn(async ({ where, data }: { where: { OR: Array<Record<string, unknown>> }; data: Record<string, unknown> }) => {
          if (!linha) return { count: 0 };
          const antes = where.OR[1] as { ultimaRodadaAutomaticaEm: { lt: Date } };
          const cabe =
            linha.ultimaRodadaAutomaticaEm === null ||
            linha.ultimaRodadaAutomaticaEm < antes.ultimaRodadaAutomaticaEm.lt;
          if (!cabe) return { count: 0 };
          Object.assign(linha, data);
          return { count: 1 };
        }),
        findUnique: vi.fn(async () => linha),
      },
    },
  };
}

describe("⭐ a reserva atômica", () => {
  it("primeira do dia: reserva e carimba quem", async () => {
    const b = bancoComConfig({ ultimaRodadaAutomaticaEm: null, ultimaRodadaAutomaticaPor: null });
    const r = await reservarRodadaAutomaticaDoDia(b.db as never, QUINTA_9H_SP, "agendador interno");
    expect(r).toEqual({ reservou: true });
    expect(b.linha()).toMatchObject({ ultimaRodadaAutomaticaEm: QUINTA_9H_SP, ultimaRodadaAutomaticaPor: "agendador interno" });
  });

  it("⛔ o cron do GitHub atrasado, no mesmo dia, NÃO reserva — e diz quem já rodou", async () => {
    const b = bancoComConfig({ ultimaRodadaAutomaticaEm: QUINTA_9H_SP, ultimaRodadaAutomaticaPor: "agendador interno" });
    const r = await reservarRodadaAutomaticaDoDia(b.db as never, new Date("2026-09-10T15:43:00Z"), "cron do GitHub");
    expect(r).toMatchObject({ reservou: false, motivo: "jaRodouHoje" });
    if (!r.reservou) expect(r.detalhe).toContain("agendador interno");
    expect(b.linha()?.ultimaRodadaAutomaticaPor).toBe("agendador interno");
  });

  it("no dia seguinte a reserva abre de novo", async () => {
    const b = bancoComConfig({ ultimaRodadaAutomaticaEm: QUINTA_9H_SP, ultimaRodadaAutomaticaPor: "agendador interno" });
    const r = await reservarRodadaAutomaticaDoDia(b.db as never, SEXTA_9H_SP, "agendador interno");
    expect(r).toEqual({ reservou: true });
  });

  it("sem configuração não reserva — prospecção que nunca foi ligada não roda", async () => {
    const b = bancoComConfig(null);
    const r = await reservarRodadaAutomaticaDoDia(b.db as never, QUINTA_9H_SP, "agendador interno");
    expect(r).toMatchObject({ reservou: false, motivo: "semConfiguracao" });
  });
});

describe("o tick", () => {
  beforeEach(() => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("fora da hora não toca no banco nem na rodada", async () => {
    const b = bancoComConfig({ ultimaRodadaAutomaticaEm: null, ultimaRodadaAutomaticaPor: null });
    const rodada = vi.fn();
    const t = await AgendadorDaProspeccao.tick({ agora: QUINTA_10H_SP, db: b.db as never, rodada, hora: 9 });
    expect(t.decisao).toBe("foraDaHora");
    expect(b.db.prospeccaoConfig.updateMany).not.toHaveBeenCalled();
    expect(rodada).not.toHaveBeenCalled();
  });

  it("⭐ na hora: reserva, roda UMA vez, e o tick seguinte na mesma manhã não roda de novo", async () => {
    const b = bancoComConfig({ ultimaRodadaAutomaticaEm: null, ultimaRodadaAutomaticaPor: null });
    const rodada = vi.fn(async () => ({ abordados: 3, pulados: 1, parouPor: "filaAcabou" as const, falha: null, extrato: [] }));

    const primeiro = await AgendadorDaProspeccao.tick({ agora: QUINTA_9H_SP, db: b.db as never, rodada, hora: 9 });
    expect(primeiro.decisao).toBe("rodou");
    expect(primeiro.rodada).toMatchObject({ abordados: 3, pulados: 1 });
    expect(rodada).toHaveBeenCalledTimes(1);
    // A rodada recebe o MESMO contrato da rota de cron: autor SISTEMA e um pré-voo.
    expect(rodada.mock.calls[0]![1]).toMatchObject({ autor: "SISTEMA", canalPronto: true });
    expect(typeof (rodada.mock.calls[0]![1] as { preVoo: unknown }).preVoo).toBe("function");

    const segundo = await AgendadorDaProspeccao.tick({ agora: QUINTA_9H30_SP, db: b.db as never, rodada, hora: 9 });
    expect(segundo.decisao).toBe("jaRodouHoje");
    expect(rodada).toHaveBeenCalledTimes(1);
  });

  it("a rodada que quebra DEPOIS da reserva vira `quebrou` com o erro — e não roda de novo sozinha", async () => {
    const b = bancoComConfig({ ultimaRodadaAutomaticaEm: null, ultimaRodadaAutomaticaPor: null });
    const rodada = vi.fn(async () => { throw new Error("banco caiu"); });
    const t = await AgendadorDaProspeccao.tick({ agora: QUINTA_9H_SP, db: b.db as never, rodada, hora: 9 });
    expect(t).toMatchObject({ decisao: "quebrou", detalhe: "banco caiu" });
    const depois = await AgendadorDaProspeccao.tick({ agora: QUINTA_9H30_SP, db: b.db as never, rodada, hora: 9 });
    expect(depois.decisao).toBe("jaRodouHoje");
  });

  it("fora de produção o start não liga nada", () => {
    process.env.NODE_ENV = "test";
    vi.spyOn(console, "log").mockImplementation(() => {});
    AgendadorDaProspeccao.start();
    expect(AgendadorDaProspeccao.estaAtivo()).toBe(false);
  });
});
