/**
 * A retentativa, medida — sem Postgres real (isso é a Jornada, em
 * `scripts/jornada-retentativa-prospeccao.test.ts`).
 *
 * O que estes casos guardam, em ordem de gravidade:
 *
 *   1. **Idempotência.** Um lead que já tem `LeadMensagem` confirmada nunca
 *      chama `abordarLead` de novo — reenviar é o próprio defeito que esta
 *      retentativa existe para não cometer.
 *   2. **A lista é o escopo, e nada além dela.** Fonte diferente de
 *      `LISTA_PROSPECCAO` é recusada, nunca tentada.
 *   3. **A reação a cada motivo é a MESMA de `abordarDaFila.ts`** — `pula`
 *      segue a lista, `encerra` (ritmo) para tudo, `pulaComLimite` conta até
 *      `LIMITE_DE_RECUSAS` e pausa, `falha` para e não esconde.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const abordar = vi.hoisted(() => vi.fn());

vi.mock("../abordar", async (original) => {
  const real = await original<typeof import("../abordar")>();
  return { ...real, abordarLead: abordar };
});

const { retentarLeadsMaterializadosSemMensagem } = await import("./retentativa");
const { LIMITE_DE_RECUSAS } = await import("./abordarDaFila");

const AGORA = new Date("2026-09-11T13:00:00Z");

function banco(over: {
  /** `fonte` de cada lead, por id. `undefined` = lead não existe. */
  leads?: Record<string, { fonte: string | null } | undefined>;
  /** Um `leadMensagem.findFirst` (a checagem de idempotência) pronto, por leadId. */
  jaConfirmada?: Record<string, { id: string; waMessageId: string | null } | null>;
} = {}) {
  const configAtualizacoes: Array<Record<string, unknown>> = [];

  return {
    configAtualizacoes,
    db: {
      siteLead: {
        findUnique: async (args: { where: { id: string } }) => {
          const l = over.leads?.[args.where.id];
          return l === undefined ? null : { id: args.where.id, fonte: l.fonte };
        },
      },
      leadMensagem: {
        findFirst: async (args: { where: { leadId: string } }) =>
          over.jaConfirmada?.[args.where.leadId] ?? null,
        findUnique: async (args: { where: { id: string } }) => ({
          waMessageId: `wamid.${args.where.id}`,
        }),
      },
      prospeccaoConfig: {
        update: async (args: { data: Record<string, unknown> }) => {
          configAtualizacoes.push(args.data);
          return {};
        },
      },
    } as never,
  };
}

beforeEach(() => {
  abordar.mockReset();
});

describe("idempotência — nunca reenvia quem já foi enviado", () => {
  it("⭐ lead com LeadMensagem confirmada não chama abordarLead, e devolve o wamid existente", async () => {
    const { db } = banco({
      leads: { L1: { fonte: "LISTA_PROSPECCAO" } },
      jaConfirmada: { L1: { id: "m-antiga", waMessageId: "wamid.antigo" } },
    });

    const r = await retentarLeadsMaterializadosSemMensagem(db, {
      leadIds: ["L1"],
      autor: "HUMANO",
      autorUserId: "u1",
      agora: AGORA,
    });

    expect(abordar).not.toHaveBeenCalled();
    expect(r.parouPor).toBe("listaAcabou");
    expect(r.resultados).toEqual([
      { leadId: "L1", enviado: true, mensagemId: "m-antiga", wamid: "wamid.antigo" },
    ]);
  });
});

describe("o escopo é a lista, e nada além dela", () => {
  it("lead que não existe é recusado, sem chamar abordarLead", async () => {
    const { db } = banco({ leads: {} });

    const r = await retentarLeadsMaterializadosSemMensagem(db, {
      leadIds: ["sumiu"],
      autor: "HUMANO",
      autorUserId: "u1",
      agora: AGORA,
    });

    expect(abordar).not.toHaveBeenCalled();
    expect(r.resultados).toEqual([
      { leadId: "sumiu", enviado: false, motivo: "leadNaoExiste", detalhe: "sumiu" },
    ]);
  });

  it("⭐ lead de OUTRA fonte é recusado — esta retentativa só recupera LISTA_PROSPECCAO", async () => {
    const { db } = banco({ leads: { L1: { fonte: "FORMULARIO_DEMONSTRACAO" } } });

    const r = await retentarLeadsMaterializadosSemMensagem(db, {
      leadIds: ["L1"],
      autor: "HUMANO",
      autorUserId: "u1",
      agora: AGORA,
    });

    expect(abordar).not.toHaveBeenCalled();
    expect(r.resultados[0]).toMatchObject({ leadId: "L1", enviado: false, motivo: "fonteInvalida" });
  });
});

describe("o envio de verdade — sempre a MESMA abordarLead, exatamente uma vez", () => {
  it("⭐ sucesso devolve o mensagemId e o wamid gravado, lidos de volta do banco", async () => {
    abordar.mockResolvedValue({ abordou: true, mensagemId: "m1" });
    const { db } = banco({ leads: { L1: { fonte: "LISTA_PROSPECCAO" } } });

    const r = await retentarLeadsMaterializadosSemMensagem(db, {
      leadIds: ["L1"],
      autor: "HUMANO",
      autorUserId: "u1",
      agora: AGORA,
    });

    expect(abordar).toHaveBeenCalledTimes(1);
    expect(abordar).toHaveBeenCalledWith(db, {
      leadId: "L1",
      autor: "HUMANO",
      autorUserId: "u1",
      agora: AGORA,
    });
    expect(r.resultados).toEqual([{ leadId: "L1", enviado: true, mensagemId: "m1", wamid: "wamid.m1" }]);
    expect(r.parouPor).toBe("listaAcabou");
  });
});

describe("a reação a cada motivo é a de abordarDaFila.ts, reaproveitada", () => {
  it("⭐ 'pula' (portaoRecusou / semDadoParaOModelo): segue a lista", async () => {
    abordar
      .mockResolvedValueOnce({ abordou: false, motivo: "portaoRecusou", detalhe: "LEAD_OPT_OUT: pediu silêncio" })
      .mockResolvedValueOnce({ abordou: true, mensagemId: "m2" });

    const { db } = banco({
      leads: { L1: { fonte: "LISTA_PROSPECCAO" }, L2: { fonte: "LISTA_PROSPECCAO" } },
    });

    const r = await retentarLeadsMaterializadosSemMensagem(db, {
      leadIds: ["L1", "L2"],
      autor: "HUMANO",
      autorUserId: "u1",
      agora: AGORA,
    });

    expect(abordar).toHaveBeenCalledTimes(2);
    expect(r.parouPor).toBe("listaAcabou");
    expect(r.resultados[0]).toMatchObject({ leadId: "L1", enviado: false, motivo: "portaoRecusou" });
    expect(r.resultados[1]).toMatchObject({ leadId: "L2", enviado: true, mensagemId: "m2" });
  });

  it("⭐ 'encerra' (ritmo): para a lista inteira, e o resto nem é tentado", async () => {
    abordar.mockResolvedValueOnce({ abordou: false, motivo: "ritmo", detalhe: "teto do dia" });

    const { db } = banco({
      leads: { L1: { fonte: "LISTA_PROSPECCAO" }, L2: { fonte: "LISTA_PROSPECCAO" } },
    });

    const r = await retentarLeadsMaterializadosSemMensagem(db, {
      leadIds: ["L1", "L2"],
      autor: "HUMANO",
      autorUserId: "u1",
      agora: AGORA,
    });

    expect(abordar).toHaveBeenCalledTimes(1);
    expect(r.parouPor).toBe("ritmo");
    expect(r.resultados).toHaveLength(1);
  });

  it("⭐⭐ 'pulaComLimite' (aMetaRecusou): pausa e para depois de LIMITE_DE_RECUSAS seguidas", async () => {
    for (let i = 0; i < LIMITE_DE_RECUSAS; i++) {
      abordar.mockResolvedValueOnce({ abordou: false, motivo: "aMetaRecusou", detalhe: "Template inválido" });
    }

    const leads: Record<string, { fonte: string | null }> = {};
    const ids: string[] = [];
    for (let i = 0; i < LIMITE_DE_RECUSAS; i++) {
      const id = `L${i}`;
      ids.push(id);
      leads[id] = { fonte: "LISTA_PROSPECCAO" };
    }

    const { db, configAtualizacoes } = banco({ leads });

    const r = await retentarLeadsMaterializadosSemMensagem(db, {
      leadIds: ids,
      autor: "HUMANO",
      autorUserId: "u1",
      agora: AGORA,
    });

    expect(abordar).toHaveBeenCalledTimes(LIMITE_DE_RECUSAS);
    expect(r.parouPor).toBe("recusasDaMeta");
    // A MESMA pausa persistente de `abordarDaFila.ts` — não uma segunda regra.
    expect(configAtualizacoes).toHaveLength(1);
    expect(configAtualizacoes[0]).toMatchObject({ pausadoPor: "sistema (freio automático)" });
  });

  it("'falha' (naoConseguiuGravar): o caminho quebrou por razão nossa — para, e o resto não é tentado", async () => {
    abordar.mockResolvedValueOnce({ abordou: false, motivo: "naoConseguiuGravar", detalhe: "banco fora do ar" });

    const { db } = banco({
      leads: { L1: { fonte: "LISTA_PROSPECCAO" }, L2: { fonte: "LISTA_PROSPECCAO" } },
    });

    const r = await retentarLeadsMaterializadosSemMensagem(db, {
      leadIds: ["L1", "L2"],
      autor: "HUMANO",
      autorUserId: "u1",
      agora: AGORA,
    });

    expect(abordar).toHaveBeenCalledTimes(1);
    expect(r.parouPor).toBe("falha");
  });
});
