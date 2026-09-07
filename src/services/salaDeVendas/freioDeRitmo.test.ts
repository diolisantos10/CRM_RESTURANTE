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
  TETO_DURO_POR_HORA,
  TETO_DURO_POR_DIA,
} from "./freioDeRitmo";

const TETOS = { hora: 30, dia: 200 };

describe("a decisão pura", () => {
  it("deixa passar quando está longe dos dois tetos", () => {
    const v = decidirPeloRitmo({ naUltimaHora: 3, nasUltimas24h: 40 }, TETOS);
    expect(v.pode).toBe(true);
  });

  it("⛔ barra EXATAMENTE no teto da hora, e não uma depois", () => {
    // O erro de um: com `>` no lugar de `>=`, a trigésima primeira sairia.
    expect(decidirPeloRitmo({ naUltimaHora: 29, nasUltimas24h: 0 }, TETOS).pode).toBe(true);
    expect(decidirPeloRitmo({ naUltimaHora: 30, nasUltimas24h: 0 }, TETOS).pode).toBe(false);
  });

  it("⛔ barra EXATAMENTE no teto do dia", () => {
    expect(decidirPeloRitmo({ naUltimaHora: 0, nasUltimas24h: 199 }, TETOS).pode).toBe(true);
    expect(decidirPeloRitmo({ naUltimaHora: 0, nasUltimas24h: 200 }, TETOS).pode).toBe(false);
  });

  it("o teto do dia ganha do teto da hora quando os dois estouram", () => {
    // Importa para a frase que vai à tela: "acabou o dia" e "espere uma hora"
    // pedem coisas diferentes de quem está operando.
    const v = decidirPeloRitmo({ naUltimaHora: 99, nasUltimas24h: 999 }, TETOS);
    expect(v.pode === false && v.motivo).toBe("tetoDoDia");
  });

  it("a recusa diz o número, não só que barrou", () => {
    const v = decidirPeloRitmo({ naUltimaHora: 30, nasUltimas24h: 30 }, TETOS);
    expect(v.pode === false && v.detalhe).toContain("30");
  });

  it("o veredicto sempre carrega as contagens, inclusive quando passa", () => {
    // Quem chama precisa poder registrar quanto já saiu, e não só se pode.
    const v = decidirPeloRitmo({ naUltimaHora: 7, nasUltimas24h: 11 }, TETOS);
    expect(v.naUltimaHora).toBe(7);
    expect(v.nasUltimas24h).toBe(11);
  });
});

describe("⛔ o ambiente só aperta, nunca afrouxa", () => {
  it("sem variável nenhuma, valem os tetos duros", () => {
    expect(tetosEmVigor({})).toEqual({ hora: TETO_DURO_POR_HORA, dia: TETO_DURO_POR_DIA });
  });

  it("valor menor aperta", () => {
    expect(tetosEmVigor({ FOOCCI_SDR_TETO_HORA: "5", FOOCCI_SDR_TETO_DIA: "50" })).toEqual({
      hora: 5,
      dia: 50,
    });
  });

  it("⛔ valor MAIOR que o teto duro é ignorado", () => {
    // Esta é a cena que dá sentido ao arquivo inteiro. Se ela passasse,
    // qualquer pessoa com acesso ao painel desligaria o freio digitando 99999.
    expect(tetosEmVigor({ FOOCCI_SDR_TETO_HORA: "99999", FOOCCI_SDR_TETO_DIA: "99999" })).toEqual({
      hora: TETO_DURO_POR_HORA,
      dia: TETO_DURO_POR_DIA,
    });
  });

  it("lixo, zero e negativo caem no teto duro — nunca em 'sem teto'", () => {
    for (const v of ["", "  ", "abc", "0", "-1", "10.5", "1e9"]) {
      const t = tetosEmVigor({ FOOCCI_SDR_TETO_HORA: v, FOOCCI_SDR_TETO_DIA: v });
      expect(t.hora, `"${v}" não pode virar teto solto`).toBeLessThanOrEqual(TETO_DURO_POR_HORA);
      expect(t.hora, `"${v}" não pode virar zero`).toBeGreaterThan(0);
    }
  });
});

describe("a contagem no banco", () => {
  function banco(naHora: number, no24h: number) {
    const perguntas: Array<Record<string, unknown>> = [];
    let n = 0;
    return {
      perguntas,
      db: {
        leadMensagem: {
          count: async (args: { where: Record<string, unknown> }) => {
            perguntas.push(args.where);
            n += 1;
            return n === 1 ? naHora : no24h;
          },
        },
      },
    };
  }

  it("⭐ conta SÓ modelo — resposta livre ao cliente não é freada", async () => {
    // Se esta cena quebrar, o freio de prospecção virou mordaça de atendimento.
    const { db, perguntas } = banco(0, 0);
    await conferirRitmo(db, new Date("2026-09-07T12:00:00Z"), TETOS);

    for (const p of perguntas) {
      expect(p.tipo).toBe("TEMPLATE");
      expect(p.direcao).toBe("SAIDA");
    }
  });

  it("conta o que SAIU, e não o que está pendente", async () => {
    // Pendente é o que ainda não saiu. Contá-lo faria uma fila represada por
    // queda da Meta bloquear o envio no minuto em que ela voltasse.
    const { db, perguntas } = banco(0, 0);
    await conferirRitmo(db, new Date("2026-09-07T12:00:00Z"), TETOS);

    const status = perguntas[0]!.status as { in: string[] };
    expect(status.in).toEqual(["ENVIADA", "ENTREGUE", "LIDA"]);
    expect(status.in).not.toContain("PENDENTE");
    expect(status.in).not.toContain("FALHOU");
  });

  it("as duas janelas são de 1 hora e de 24 horas, contadas de agora", async () => {
    const agora = new Date("2026-09-07T12:00:00Z");
    const { db, perguntas } = banco(0, 0);
    await conferirRitmo(db, agora, TETOS);

    const hora = (perguntas[0]!.ocorreuEm as { gte: Date }).gte;
    const dia = (perguntas[1]!.ocorreuEm as { gte: Date }).gte;
    expect(agora.getTime() - hora.getTime()).toBe(60 * 60 * 1000);
    expect(agora.getTime() - dia.getTime()).toBe(24 * 60 * 60 * 1000);
  });

  it("estourado na hora, recusa", async () => {
    const { db } = banco(30, 30);
    const v = await conferirRitmo(db, new Date(), TETOS);
    expect(v.pode).toBe(false);
  });

  it("sonda de controle: base zerada deixa passar", async () => {
    // Sem esta, os testes acima passariam com um `conferirRitmo` que recusa
    // sempre — e o freio estaria travando tudo em vez de frear.
    const { db } = banco(0, 0);
    const v = await conferirRitmo(db, new Date(), TETOS);
    expect(v.pode).toBe(true);
  });
});
