/**
 * A ADEQUAÇÃO DO TEMPLATE — provas de `julgarAdequacao` (pura) e de
 * `avaliarAdequacaoDoTemplate` (a régua de modo, com banco dublado).
 *
 * A jornada contra Postgres real (SHADOW não atrasa, GUARD bloqueia de
 * verdade) mora em `scripts/jornada-supervisora-abordagem.test.ts` — este
 * arquivo cobre a REGRA em si, rápido e sem rede/banco de verdade.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const lerConfig = vi.hoisted(() => vi.fn());
const modoEfetivo = vi.hoisted(() => vi.fn());
vi.mock("./config", () => ({ lerConfig, modoEfetivo }));

import { julgarAdequacao, avaliarAdequacaoDoTemplate, type HistoricoDeAbordagens } from "./adequacaoDoTemplate";

const AGORA = new Date("2026-09-12T18:00:00Z");

const HISTORICO_SAUDAVEL: HistoricoDeAbordagens = {
  tentativasAnteriores: 0,
  ultimaAbordagemEm: null,
  optOutAt: null,
};

describe("julgarAdequacao — pura, sem banco", () => {
  it("lead saudável (nunca abordado, sem opt-out) → VERDE", () => {
    const r = julgarAdequacao(HISTORICO_SAUDAVEL, AGORA);
    expect(r.veredito).toBe("VERDE");
    expect(r.motivos).toEqual([]);
  });

  it("opt-out → VERMELHO, mesmo sem nenhuma tentativa anterior", () => {
    const r = julgarAdequacao({ ...HISTORICO_SAUDAVEL, optOutAt: new Date("2026-09-10") }, AGORA);
    expect(r.veredito).toBe("VERMELHO");
    expect(r.motivos).toContain("INSISTENCIA_APOS_RECUSA");
    expect(r.detalhe).toContain("optOutAt");
  });

  it("já tentou o teto (2, uma abertura e um lembrete) → VERMELHO por insistência", () => {
    const r = julgarAdequacao({ ...HISTORICO_SAUDAVEL, tentativasAnteriores: 2 }, AGORA);
    expect(r.veredito).toBe("VERMELHO");
    expect(r.motivos).toContain("INSISTENCIA_APOS_RECUSA");
    expect(r.detalhe).toContain("2 abordagens");
  });

  it("abaixo do teto de tentativas (1) mas dentro da janela de descanso → VERMELHO por timing", () => {
    const r = julgarAdequacao(
      { ...HISTORICO_SAUDAVEL, tentativasAnteriores: 1, ultimaAbordagemEm: new Date("2026-09-12T10:00:00Z") },
      AGORA,
    );
    expect(r.veredito).toBe("VERMELHO");
    expect(r.motivos).toContain("TIMING_RUIM");
  });

  it("abaixo do teto de tentativas e fora da janela de descanso → VERDE", () => {
    const r = julgarAdequacao(
      { ...HISTORICO_SAUDAVEL, tentativasAnteriores: 1, ultimaAbordagemEm: new Date("2026-09-01T10:00:00Z") },
      AGORA,
    );
    expect(r.veredito).toBe("VERDE");
  });

  it("nunca devolve AMARELO nem CRITICO — vocabulário restrito a VERDE/VERMELHO", () => {
    const casos: HistoricoDeAbordagens[] = [
      HISTORICO_SAUDAVEL,
      { ...HISTORICO_SAUDAVEL, optOutAt: AGORA },
      { ...HISTORICO_SAUDAVEL, tentativasAnteriores: 5 },
    ];
    for (const c of casos) {
      const r = julgarAdequacao(c, AGORA);
      expect(["VERDE", "VERMELHO"]).toContain(r.veredito);
    }
  });
});

/** Um `db` mínimo que só sabe gravar `supervisoraAvaliacao.create` e grita se
 *  algo além disso for chamado — mesmo espírito do dublê de `latencia.test.ts`. */
function dbQueGrava() {
  const gravadas: Array<Record<string, unknown>> = [];
  return {
    gravadas,
    db: {
      supervisoraAvaliacao: {
        create: async (args: { data: Record<string, unknown> }) => {
          gravadas.push(args.data);
          return { id: `avaliacao-${gravadas.length}` };
        },
      },
    } as never,
  };
}

const PARAMS_BASE = {
  mensagemId: "m1",
  leadId: "l1",
  autor: "SISTEMA" as const,
  autorUserId: "sistema",
  historico: HISTORICO_SAUDAVEL,
  agora: AGORA,
};

describe("avaliarAdequacaoDoTemplate — a régua de modo (banco dublado)", () => {
  beforeEach(() => {
    lerConfig.mockReset();
    modoEfetivo.mockReset();
  });

  it("OFF: não grava nada e libera", async () => {
    lerConfig.mockResolvedValue({ ligada: false, modo: "OFF" });
    modoEfetivo.mockReturnValue("OFF");
    const { db, gravadas } = dbQueGrava();

    const r = await avaliarAdequacaoDoTemplate(db, PARAMS_BASE);

    expect(r).toEqual({ prosseguir: true, avaliacaoId: null, motivoDeRetencao: null });
    expect(gravadas).toHaveLength(0);
  });

  it("GUARD, lead saudável (VERDE) → libera e grava NENHUMA ação", async () => {
    lerConfig.mockResolvedValue({ ligada: true, modo: "GUARD" });
    modoEfetivo.mockReturnValue("GUARD");
    const { db, gravadas } = dbQueGrava();

    const r = await avaliarAdequacaoDoTemplate(db, PARAMS_BASE);

    expect(r.prosseguir).toBe(true);
    expect(gravadas[0]).toMatchObject({ veredito: "VERDE", bloqueada: false, acaoTomada: "NENHUMA" });
    // Nunca reescreve: os dois campos de texto ficam nulos sempre.
    expect(gravadas[0]).toMatchObject({ textoOriginal: null, textoReescrito: null });
  });

  it("GUARD, lead com opt-out → BARRA de verdade, antes de `enviarModeloDeVendas`", async () => {
    lerConfig.mockResolvedValue({ ligada: true, modo: "GUARD" });
    modoEfetivo.mockReturnValue("GUARD");
    const { db, gravadas } = dbQueGrava();

    const r = await avaliarAdequacaoDoTemplate(db, {
      ...PARAMS_BASE,
      historico: { ...HISTORICO_SAUDAVEL, optOutAt: new Date("2026-09-10") },
    });

    expect(r.prosseguir).toBe(false);
    expect(r.motivoDeRetencao).toContain("optOutAt");
    expect(gravadas[0]).toMatchObject({ veredito: "VERMELHO", bloqueada: true, acaoTomada: "BLOQUEOU" });
  });

  it("INTERVENTION também bloqueia (mesma régua de GUARD+)", async () => {
    lerConfig.mockResolvedValue({ ligada: true, modo: "INTERVENTION" });
    modoEfetivo.mockReturnValue("INTERVENTION");
    const { db } = dbQueGrava();

    const r = await avaliarAdequacaoDoTemplate(db, {
      ...PARAMS_BASE,
      historico: { ...HISTORICO_SAUDAVEL, tentativasAnteriores: 3 },
    });

    expect(r.prosseguir).toBe(false);
  });

  it("SHADOW: devolve liberado NA HORA, sem esperar a gravação em segundo plano", async () => {
    lerConfig.mockResolvedValue({ ligada: true, modo: "SHADOW" });
    modoEfetivo.mockReturnValue("SHADOW");
    const { db } = dbQueGrava();

    const inicio = performance.now();
    const r = await avaliarAdequacaoDoTemplate(db, {
      ...PARAMS_BASE,
      historico: { ...HISTORICO_SAUDAVEL, optOutAt: new Date("2026-09-10") }, // seria barrado em GUARD
    });
    const decorrido = performance.now() - inicio;

    // Mesmo com um histórico que SERIA barrado, SHADOW libera — a avaliação
    // roda em segundo plano e não decide a entrega.
    expect(r).toEqual({ prosseguir: true, avaliacaoId: null, motivoDeRetencao: null });
    expect(decorrido).toBeLessThan(50);
  });

  it("não conseguir LER a config age como SHADOW: libera na hora, nunca lança", async () => {
    lerConfig.mockRejectedValue(new Error("banco fora do ar"));
    const { db } = dbQueGrava();

    const r = await avaliarAdequacaoDoTemplate(db, PARAMS_BASE);

    expect(r).toEqual({ prosseguir: true, avaliacaoId: null, motivoDeRetencao: null });
  });
});
