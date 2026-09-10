/**
 * O freio de ritmo, medido.
 *
 * O que estes casos protegem, em ordem de gravidade:
 *
 *   1. **O ambiente não afrouxa a trava.** Uma variável que pode desligar o
 *      freio faz dele uma sugestão. Ela só aperta.
 *   2. **A resposta ao cliente não é freada.** O freio conta abordagem
 *      (modelo), nunca conversa livre — senão viraria mordaça de atendimento.
 *   3. **O erro de um.** `>` no lugar de `>=` deixaria passar uma a mais, e o
 *      erro seria sempre na direção de mandar demais.
 */

import { describe, it, expect } from "vitest";
import {
  decidirPeloRitmo,
  tetosEmVigor,
  conferirRitmo,
  TETO_DURO_POR_DIA,
} from "./freioDeRitmo";

const TETOS = { dia: 2000 };

describe("a decisão pura", () => {
  it("deixa passar quando está longe do teto", () => {
    const v = decidirPeloRitmo({ nasUltimas24h: 400 }, TETOS);
    expect(v.pode).toBe(true);
  });

  it("⛔ barra EXATAMENTE no teto do dia, e não uma depois", () => {
    // O erro de um: com `>` no lugar de `>=`, a (N+1)ª sairia.
    expect(decidirPeloRitmo({ nasUltimas24h: 1999 }, TETOS).pode).toBe(true);
    expect(decidirPeloRitmo({ nasUltimas24h: 2000 }, TETOS).pode).toBe(false);
  });

  it("a recusa diz o número, não só que barrou", () => {
    const v = decidirPeloRitmo({ nasUltimas24h: 2000 }, TETOS);
    expect(v.pode === false && v.detalhe).toContain("2000");
  });

  it("o veredicto sempre carrega a contagem, inclusive quando passa", () => {
    // Quem chama precisa poder registrar quanto já saiu, e não só se pode.
    const v = decidirPeloRitmo({ nasUltimas24h: 500 }, TETOS);
    expect(v.nasUltimas24h).toBe(500);
  });
});

describe("⛔ o ambiente só aperta, nunca afrouxa", () => {
  it("sem variável nenhuma, vale o teto duro", () => {
    expect(tetosEmVigor({})).toEqual({ dia: TETO_DURO_POR_DIA });
  });

  it("valor menor aperta", () => {
    expect(tetosEmVigor({ FOOCCI_SDR_TETO_DIA: "500" })).toEqual({
      dia: 500,
    });
  });

  it("⛔ valor MAIOR que o teto duro é ignorado", () => {
    expect(tetosEmVigor({ FOOCCI_SDR_TETO_DIA: "99999" })).toEqual({
      dia: TETO_DURO_POR_DIA,
    });
  });

  it("lixo, zero e negativo caem no teto duro — nunca em 'sem teto'", () => {
    for (const v of ["", "  ", "abc", "0", "-1", "10.5", "1e9"]) {
      const t = tetosEmVigor({ FOOCCI_SDR_TETO_DIA: v });
      expect(t.dia, `"${v}" não pode virar teto solto`).toBeLessThanOrEqual(TETO_DURO_POR_DIA);
      expect(t.dia, `"${v}" não pode virar zero`).toBeGreaterThan(0);
    }
  });
});

describe("a contagem no banco", () => {
  function banco(no24h: number) {
    const perguntas: Array<Record<string, unknown>> = [];
    return {
      perguntas,
      db: {
        leadMensagem: {
          count: async (args: { where: Record<string, unknown> }) => {
            perguntas.push(args.where);
            return no24h;
          },
        },
      },
    };
  }

  it("⭐ conta SÓ modelo — resposta livre ao cliente não é freada", async () => {
    // Se esta cena quebrar, o freio de prospecção virou mordaça de atendimento.
    const { db, perguntas } = banco(0);
    await conferirRitmo(db, new Date("2026-09-07T12:00:00Z"), TETOS);

    for (const p of perguntas) {
      expect(p.tipo).toBe("TEMPLATE");
      expect(p.direcao).toBe("SAIDA");
    }
  });

  it("conta o que SAIU, e não o que está pendente", async () => {
    const { db, perguntas } = banco(0);
    await conferirRitmo(db, new Date("2026-09-07T12:00:00Z"), TETOS);

    const status = perguntas[0]!.status as { in: string[] };
    expect(status.in).toEqual(["ENVIADA", "ENTREGUE", "LIDA"]);
    expect(status.in).not.toContain("PENDENTE");
    expect(status.in).not.toContain("FALHOU");
  });

  it("a janela é de 24 horas, contada de agora", async () => {
    const agora = new Date("2026-09-07T12:00:00Z");
    const { db, perguntas } = banco(0);
    await conferirRitmo(db, agora, TETOS);

    const dia = (perguntas[0]!.ocorreuEm as { gte: Date }).gte;
    expect(agora.getTime() - dia.getTime()).toBe(24 * 60 * 60 * 1000);
  });

  it("estourado no dia, recusa", async () => {
    const { db } = banco(2000);
    const v = await conferirRitmo(db, new Date(), TETOS);
    expect(v.pode).toBe(false);
  });

  it("sonda de controle: base zerada deixa passar", async () => {
    // Sem esta, os testes acima passariam com um `conferirRitmo` que recusa
    // sempre — e o freio estaria travando tudo em vez de frear.
    const { db } = banco(0);
    const v = await conferirRitmo(db, new Date(), TETOS);
    expect(v.pode).toBe(true);
  });
});
