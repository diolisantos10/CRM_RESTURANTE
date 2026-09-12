import { describe, it, expect } from "vitest";
import { avaliarAvisoOperacional, type AvisoOperacionalInput } from "./avisoOperacional";

/** Estado "tudo bem" — cada teste desvia só o que precisa provar. */
const TUDO_OK: AvisoOperacionalInput = {
  canal: { ok: true },
  envioAutorizado: true,
  preVoo: { pronto: true },
  conferencia: { elegiveisSeAtivar: 10, pendentes: 10, saldoDiario: 50, saldoDaJanela: 500, tetoDoDia: 100 },
};

describe("avaliarAvisoOperacional", () => {
  it("nada carregado ainda → nenhum aviso (não afirma problema sem dado)", () => {
    expect(
      avaliarAvisoOperacional({ canal: null, envioAutorizado: null, preVoo: null, conferencia: null }),
    ).toBeNull();
  });

  it("tudo pronto → nenhum aviso", () => {
    expect(avaliarAvisoOperacional(TUDO_OK)).toBeNull();
  });

  it("canal indisponível (sem credencial) → aviso de canal, não de token", () => {
    const r = avaliarAvisoOperacional({
      ...TUDO_OK,
      canal: { ok: false, causa: "semPhoneNumberId", detalhe: "sem id" },
    });
    expect(r?.titulo).toMatch(/não está disponível/);
  });

  it("token inválido (Meta recusou) → aviso distinto do canal indisponível", () => {
    const r = avaliarAvisoOperacional({
      ...TUDO_OK,
      canal: { ok: false, causa: "aMetaRecusou", detalhe: "401" },
    });
    expect(r?.titulo).toMatch(/credencial.*não está válida/);
  });

  it("envio não autorizado (FOOCCI_SDR_SEND_ENABLED desligado) → aviso próprio, sem citar variável", () => {
    const r = avaliarAvisoOperacional({ ...TUDO_OK, envioAutorizado: false });
    expect(r?.titulo).toMatch(/ainda não foi autorizado/);
    expect(r?.titulo).not.toMatch(/FOOCCI_SDR_SEND_ENABLED/);
  });

  it("modelo não aprovado → aviso próprio", () => {
    const r = avaliarAvisoOperacional({
      ...TUDO_OK,
      preVoo: { pronto: false, causa: "naoAprovado", detalhe: "PENDING" },
    });
    expect(r?.titulo).toMatch(/ainda não foi aprovado pela Meta/);
  });

  it("modelo não autorizado internamente → aviso distinto de 'não aprovado'", () => {
    const r = avaliarAvisoOperacional({
      ...TUDO_OK,
      preVoo: { pronto: false, causa: "naoAutorizado", detalhe: "autorizado=false" },
    });
    expect(r?.titulo).toMatch(/não foi autorizado internamente/);
  });

  it("variáveis do modelo não batem → pede sincronização", () => {
    const r = avaliarAvisoOperacional({
      ...TUDO_OK,
      preVoo: { pronto: false, causa: "variaveisNaoBatem", detalhe: "espera 2, monta 1" },
    });
    expect(r?.titulo).toMatch(/sincronizado/);
  });

  it("saldo diário esgotado → aviso de limite do dia, não de janela da Meta", () => {
    const r = avaliarAvisoOperacional({
      ...TUDO_OK,
      conferencia: { elegiveisSeAtivar: 10, pendentes: 10, saldoDiario: 0, saldoDaJanela: 500, tetoDoDia: 100 },
    });
    expect(r?.titulo).toMatch(/limite de abordagens de hoje/);
  });

  it("saldo da janela de 24h da Meta esgotado → aviso próprio", () => {
    const r = avaliarAvisoOperacional({
      ...TUDO_OK,
      conferencia: { elegiveisSeAtivar: 10, pendentes: 10, saldoDiario: 50, saldoDaJanela: 0, tetoDoDia: 100 },
    });
    expect(r?.titulo).toMatch(/últimas 24 horas/);
  });

  it("nenhum contato elegível, com pendentes existindo → aviso distinto de base vazia", () => {
    const r = avaliarAvisoOperacional({
      ...TUDO_OK,
      conferencia: { elegiveisSeAtivar: 0, pendentes: 40, saldoDiario: 50, saldoDaJanela: 500, tetoDoDia: 100 },
    });
    expect(r?.titulo).toMatch(/Não há contatos elegíveis/);
  });

  it("base vazia (zero pendentes) → aviso de base vazia, não de elegibilidade", () => {
    const r = avaliarAvisoOperacional({
      ...TUDO_OK,
      conferencia: { elegiveisSeAtivar: 0, pendentes: 0, saldoDiario: 50, saldoDaJanela: 500, tetoDoDia: 100 },
    });
    expect(r?.titulo).toMatch(/Não há contatos na base/);
  });

  it("teto do dia zero (nunca configurado) não dispara falso aviso de saldo esgotado", () => {
    const r = avaliarAvisoOperacional({
      ...TUDO_OK,
      conferencia: { elegiveisSeAtivar: 10, pendentes: 10, saldoDiario: 0, saldoDaJanela: 0, tetoDoDia: 0 },
    });
    expect(r).toBeNull();
  });

  it("canal indisponível tem prioridade sobre qualquer outra causa", () => {
    const r = avaliarAvisoOperacional({
      canal: { ok: false, causa: "semToken", detalhe: "sem token" },
      envioAutorizado: false,
      preVoo: { pronto: false, causa: "naoAprovado" },
      conferencia: { elegiveisSeAtivar: 0, pendentes: 0, saldoDiario: 0, saldoDaJanela: 0, tetoDoDia: 0 },
    });
    expect(r?.titulo).toMatch(/não está disponível/);
  });
});
