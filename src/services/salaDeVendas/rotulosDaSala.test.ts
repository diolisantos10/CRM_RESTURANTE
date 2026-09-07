/**
 * O mesmo aferidor do CRM antigo, aplicado antes de o defeito acontecer.
 *
 * A fonte da verdade é `TODAS_AS_ETAPAS`, do funil — externa a este mapa. Um
 * teste sobre `Object.keys(ROTULO_CURTO)` estaria conferindo a lista consigo
 * mesma e passaria feliz com uma etapa faltando.
 */

import { describe, it, expect } from "vitest";
import { ROTULO_CURTO, ETAPAS_NA_SALA, rotuloCurto } from "./rotulosDaSala";
import { TODAS_AS_ETAPAS, ROTULO_ETAPA } from "@/services/foocci-crm/foocciCrmFunnel";
import type { FoocciLeadStage } from "@/services/foocci-crm/foocciCrmFunnel";

describe("nenhuma etapa fica sem palavra na Sala", () => {
  it("toda etapa do funil tem rótulo curto", () => {
    expect(TODAS_AS_ETAPAS.length).toBeGreaterThan(0); // sonda: a fonte foi lida
    const sem = TODAS_AS_ETAPAS.filter((e) => !ROTULO_CURTO[e]);
    expect(sem).toEqual([]);
  });

  it("não sobra rótulo para etapa que o funil não conhece", () => {
    const doFunil = new Set<string>(TODAS_AS_ETAPAS);
    expect(Object.keys(ROTULO_CURTO).filter((e) => !doFunil.has(e))).toEqual([]);
  });

  it("⛔ toda etapa do funil pode ser ESCOLHIDA no seletor da Sala", () => {
    // O defeito que isto barra: uma etapa nova entra no funil, o vendedor a vê
    // no Funil e não consegue mover o lead para ela pela ficha. Ninguém sente
    // falta de uma opção que nunca viu.
    expect([...ETAPAS_NA_SALA].sort()).toEqual([...TODAS_AS_ETAPAS].sort());
  });
});

describe("a queda controlada", () => {
  it("etapa sem rótulo curto cai no canônico", () => {
    // Simula o dia seguinte a alguém acrescentar uma etapa só no funil.
    const semCurto = TODAS_AS_ETAPAS.find((e) => ROTULO_ETAPA[e]) as FoocciLeadStage;
    expect(rotuloCurto(semCurto)).toBeTruthy();
  });

  it("etapa que ninguém conhece aparece pelo próprio código, e não vazia", () => {
    expect(rotuloCurto("ETAPA_QUE_NAO_EXISTE")).toBe("ETAPA_QUE_NAO_EXISTE");
  });

  it("sonda de controle: o curto GANHA do canônico quando os dois existem", () => {
    // Sem isto, `rotuloCurto` poderia estar devolvendo sempre o canônico e os
    // testes acima continuariam verdes — a coluna estreita voltaria a quebrar.
    expect(ROTULO_ETAPA.GANHO).toBe("Fechado — ganho");
    expect(rotuloCurto("GANHO")).toBe("Ganho");
  });
});
