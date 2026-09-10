/**
 * A TRAVA DA CONVERSA — os casos que provam que duas respostas não saem.
 *
 * ── COMO SE FINGE UMA CORRIDA SEM POSTGRES ──────────────────────────────────
 *
 * O dublê abaixo guarda as travas num `Map` e **reproduz as duas regras do banco
 * que importam**: a chave primária recusa o segundo `create` (P2002), e o
 * `updateMany` condicional só casa a linha se ela realmente estiver vencida.
 *
 * ⚠️ Isto não prova o comportamento do Postgres sob concorrência real — nenhum
 * teste em processo único prova. O que ele prova é a LÓGICA que se apoia nesse
 * comportamento: que a colisão é tratada, que a trava vencida é roubada uma vez
 * só, e que ninguém solta a trava alheia. A garantia de atomicidade está
 * documentada em `tomarATrava`, com o motivo, e é do banco.
 */

import { describe, it, expect, vi } from "vitest";
import {
  aTravaAindaEMinha,
  comATravaDaConversa,
  soltarATrava,
  tomarATrava,
  VALIDADE_DA_TRAVA_MS,
} from "./travaDaConversa";

const AGORA = new Date("2026-09-10T12:00:00Z");

interface Linha {
  leadId: string;
  donoDoTurno: string;
  tomadaEm: Date;
  expiraEm: Date;
  ultimaEntradaId: string | null;
}

/** Um Postgres de mentira, com as duas regras que esta trava usa. */
function bancoDeTravas(inicial: Linha[] = []) {
  const linhas = new Map<string, Linha>(inicial.map((l) => [l.leadId, l]));

  return {
    linhas,
    travaDaConversa: {
      create: vi.fn(async ({ data }: { data: Linha }) => {
        // A chave primária. É ela que decide a corrida no caso comum.
        if (linhas.has(data.leadId)) {
          const e = new Error("Unique constraint failed") as Error & { code: string };
          e.code = "P2002";
          throw e;
        }
        linhas.set(data.leadId, { ...data });
        return data;
      }),
      updateMany: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { leadId: string; expiraEm: { lte: Date } };
          data: Partial<Linha>;
        }) => {
          const atual = linhas.get(where.leadId);
          // A condição do `WHERE`, reavaliada — é o que faz dois ladrões darem
          // um roubo só.
          if (!atual || atual.expiraEm.getTime() > where.expiraEm.lte.getTime()) {
            return { count: 0 };
          }
          linhas.set(where.leadId, { ...atual, ...data } as Linha);
          return { count: 1 };
        },
      ),
      deleteMany: vi.fn(
        async ({ where }: { where: { leadId: string; donoDoTurno: string } }) => {
          const atual = linhas.get(where.leadId);
          // Só apaga a SUA. A cláusula do dono está no `where` de propósito.
          if (!atual || atual.donoDoTurno !== where.donoDoTurno) return { count: 0 };
          linhas.delete(where.leadId);
          return { count: 1 };
        },
      ),
      findUnique: vi.fn(async ({ where }: { where: { leadId: string } }) =>
        linhas.get(where.leadId) ?? null,
      ),
    },
  };
}

describe("⭐ uma conversa, um turno", () => {
  it("o primeiro toma a trava", async () => {
    const db = bancoDeTravas();
    const r = await tomarATrava(db as never, { leadId: "l1", agora: AGORA });

    expect(r.tomada).toBe(true);
    expect(db.linhas.get("l1")?.expiraEm.getTime()).toBe(
      AGORA.getTime() + VALIDADE_DA_TRAVA_MS,
    );
  });

  it("⭐ o segundo NÃO toma — é este caso que impede a resposta dupla", async () => {
    const db = bancoDeTravas();
    await tomarATrava(db as never, { leadId: "l1", agora: AGORA });

    const segundo = await tomarATrava(db as never, { leadId: "l1", agora: AGORA });
    expect(segundo.tomada).toBe(false);
  });

  it("⛔ a sonda de controle: conversa DIFERENTE não é bloqueada", async () => {
    // Sem esta, uma trava global (um booleano no módulo, digamos) passaria no
    // caso acima e calaria a Sala inteira: um lead por vez, no mundo todo.
    const db = bancoDeTravas();
    await tomarATrava(db as never, { leadId: "l1", agora: AGORA });

    const outro = await tomarATrava(db as never, { leadId: "l2", agora: AGORA });
    expect(outro.tomada).toBe(true);
  });
});

describe("a trava vencida é roubada — uma vez só", () => {
  const VENCIDA: Linha = {
    leadId: "l1",
    donoDoTurno: "processo-morto",
    tomadaEm: new Date(AGORA.getTime() - 200_000),
    expiraEm: new Date(AGORA.getTime() - 100_000),
    ultimaEntradaId: null,
  };

  it("⭐ um processo que morreu no meio do turno não tranca a conversa para sempre", async () => {
    const db = bancoDeTravas([VENCIDA]);
    const r = await tomarATrava(db as never, { leadId: "l1", agora: AGORA });

    expect(r.tomada).toBe(true);
    expect(db.linhas.get("l1")?.donoDoTurno).not.toBe("processo-morto");
  });

  it("⛔ e o segundo ladrão sai de mãos vazias", async () => {
    const db = bancoDeTravas([VENCIDA]);
    const primeiro = await tomarATrava(db as never, { leadId: "l1", agora: AGORA });
    const segundo = await tomarATrava(db as never, { leadId: "l1", agora: AGORA });

    expect(primeiro.tomada).toBe(true);
    expect(segundo.tomada).toBe(false);
  });

  it("⛔ trava VIVA não é roubada", async () => {
    // A sonda que separa "expira" de "não vale nada".
    const db = bancoDeTravas([
      { ...VENCIDA, expiraEm: new Date(AGORA.getTime() + 60_000) },
    ]);
    const r = await tomarATrava(db as never, { leadId: "l1", agora: AGORA });

    expect(r.tomada).toBe(false);
    expect(db.linhas.get("l1")?.donoDoTurno).toBe("processo-morto");
  });
});

describe("⛔ ninguém solta a trava alheia", () => {
  it("soltar com o bilhete errado não apaga nada", async () => {
    // O caso concreto: um turno lento perde a trava por vencimento, outro
    // assume, e o lento termina e tenta soltar. Sem a cláusula do dono, ele
    // apagaria a trava do turno novo — e sobrariam dois turnos soltos na mesma
    // conversa, causados pela própria trava.
    const db = bancoDeTravas();
    const meu = await tomarATrava(db as never, { leadId: "l1", agora: AGORA });
    expect(meu.tomada).toBe(true);

    const r = await soltarATrava(db as never, { leadId: "l1", donoDoTurno: "outro-turno" });
    expect(r.soltou).toBe(false);
    expect(db.linhas.has("l1")).toBe(true);
  });

  it("e com o bilhete certo, solta", async () => {
    const db = bancoDeTravas();
    const meu = await tomarATrava(db as never, { leadId: "l1", agora: AGORA });
    if (!meu.tomada) throw new Error("não tomou a trava");

    const r = await soltarATrava(db as never, { leadId: "l1", donoDoTurno: meu.donoDoTurno });
    expect(r.soltou).toBe(true);
    expect(db.linhas.has("l1")).toBe(false);
  });

  it("`aTravaAindaEMinha` responde não depois de a trava vencer", async () => {
    const db = bancoDeTravas();
    const meu = await tomarATrava(db as never, { leadId: "l1", agora: AGORA });
    if (!meu.tomada) throw new Error("não tomou a trava");

    const depois = new Date(AGORA.getTime() + VALIDADE_DA_TRAVA_MS + 1);
    expect(
      await aTravaAindaEMinha(db as never, {
        leadId: "l1",
        donoDoTurno: meu.donoDoTurno,
        agora: depois,
      }),
    ).toBe(false);
  });
});

describe("comATravaDaConversa", () => {
  it("solta a trava mesmo quando o trabalho explode", async () => {
    // Sem o `finally`, uma exceção no meio do turno deixaria a conversa muda
    // por um minuto e meio — punindo o lead por um erro nosso.
    const db = bancoDeTravas();

    await expect(
      comATravaDaConversa(db as never, { leadId: "l1", agora: AGORA }, async () => {
        throw new Error("o modelo caiu");
      }),
    ).rejects.toThrow("o modelo caiu");

    expect(db.linhas.has("l1")).toBe(false);
  });

  it("devolve null quando a conversa já tem dono — e não roda o trabalho", async () => {
    const db = bancoDeTravas();
    await tomarATrava(db as never, { leadId: "l1", agora: AGORA });

    const trabalho = vi.fn();
    const r = await comATravaDaConversa(db as never, { leadId: "l1", agora: AGORA }, trabalho);

    expect(r).toBeNull();
    expect(trabalho).not.toHaveBeenCalled();
  });

  it("⭐⭐ TRAVA QUEBRADA NÃO CALA O AGENTE — segue sem ela, e grita no log", async () => {
    // O risco medido no minuto em que a trava foi ligada: se a tabela não
    // existe (migração atrás do deploy), `create` levanta, a exceção sobe, o
    // webhook responde 200 e **todo lead fica sem resposta**, em silêncio.
    //
    // Sem trava, o pior caso é a resposta dupla que existia ontem. Com a trava
    // quebrando o turno, o pior caso é a Sala inteira muda sem ninguém notar.
    const erro = vi.spyOn(console, "error").mockImplementation(() => {});
    const db = {
      travaDaConversa: {
        create: vi.fn().mockRejectedValue(new Error('relation "travas_da_conversa" does not exist')),
        updateMany: vi.fn(),
        deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
        findUnique: vi.fn().mockResolvedValue(null),
      },
    };

    const r = await comATravaDaConversa(db as never, { leadId: "l1", agora: AGORA }, async () => "respondeu");

    expect(r).toBe("respondeu");
    expect(
      erro.mock.calls.some((c) => String(c[0]).includes("A TRAVA FALHOU")),
      "seguiu sem trava e não avisou ninguém — o pior dos dois mundos",
    ).toBe(true);

    erro.mockRestore();
  });
});
