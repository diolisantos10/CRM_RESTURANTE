/**
 * ⛔ "NENHUM LEAD PODE DESAPARECER DEPOIS DA PRIMEIRA MENSAGEM" — P0.5.
 *
 * A Sala tinha filas e ficha, e não tinha a lista inteira. Um lead abordado que
 * não respondeu, não tem próxima ação e não foi marcado como perdido não
 * aparecia em fila nenhuma: não é meu, não está largado, não aguarda humano.
 * Sumia — justamente quem custou uma abordagem.
 *
 * `semDesfecho` é a fila desse lead, e estes casos são a regra dela.
 */

import { describe, it, expect } from "vitest";
import { estadoDoLead } from "./carteira";

const AGORA = new Date("2026-09-10T15:00:00Z");
const ONTEM = new Date("2026-09-09T15:00:00Z");
const AMANHA = new Date("2026-09-11T15:00:00Z");

function lead(over: Partial<Parameters<typeof estadoDoLead>[0]> = {}) {
  return {
    optOutAt: null,
    stage: "NOVO",
    lastContactedAt: null,
    ultimaRespostaEm: null,
    proximaAcaoEm: null,
    ...over,
  };
}

describe("⭐ o lead que sumia", () => {
  it("abordado, sem resposta, sem próxima ação e sem desfecho → semDesfecho", () => {
    expect(estadoDoLead(lead({ lastContactedAt: ONTEM }), AGORA)).toBe("semDesfecho");
  });

  it("sonda de controle: quem NÃO foi abordado não cai em semDesfecho", () => {
    // Sem esta, `semDesfecho` poderia estar pegando a base inteira e a fila
    // não significaria nada.
    expect(estadoDoLead(lead(), AGORA)).toBe("nuncaAbordado");
  });
});

describe("a ordem das perguntas é a regra", () => {
  it("⛔ silenciado ganha de TUDO, inclusive de follow-up vencido", () => {
    // Quem pediu para parar não entra em fila de trabalho nenhuma — nem como
    // pendência a resolver.
    const r = estadoDoLead(
      lead({ optOutAt: ONTEM, lastContactedAt: ONTEM, proximaAcaoEm: ONTEM, stage: "GANHO" }),
      AGORA,
    );
    expect(r).toBe("silenciados");
  });

  it("desfecho ganha de pendência", () => {
    expect(estadoDoLead(lead({ stage: "GANHO", lastContactedAt: ONTEM, proximaAcaoEm: ONTEM }), AGORA)).toBe("ganhos");
    expect(estadoDoLead(lead({ stage: "PERDIDO", lastContactedAt: ONTEM }), AGORA)).toBe("perdidos");
  });

  it("promessa vencida ganha de espera", () => {
    expect(estadoDoLead(lead({ lastContactedAt: ONTEM, proximaAcaoEm: ONTEM }), AGORA)).toBe("followUpVencido");
    expect(estadoDoLead(lead({ lastContactedAt: ONTEM, proximaAcaoEm: AMANHA }), AGORA)).toBe("aguardandoResposta");
  });

  it("quem respondeu está em conversa, não abandonado", () => {
    expect(estadoDoLead(lead({ lastContactedAt: ONTEM, ultimaRespostaEm: ONTEM }), AGORA)).toBe("aguardandoResposta");
  });

  it("o vencimento é no instante, não no dia seguinte", () => {
    // `<=`: uma promessa marcada para agora está vencida agora.
    expect(estadoDoLead(lead({ lastContactedAt: ONTEM, proximaAcaoEm: AGORA }), AGORA)).toBe("followUpVencido");
  });
});
