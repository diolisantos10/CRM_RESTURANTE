/**
 * O ID DA CONTA (WABA) DA SALA, LIDO DO ENVELOPE — 09/09/2026.
 *
 * ⚠️ POR QUE ESTE ARQUIVO EXISTE. Na noite de 08/09 a prospecção parou por um
 * número só: a Sala não sabia a qual conta perguntar quais modelos existem, e os
 * três caminhos da Graph foram medidos e falham com o token de produção. O registro
 * daquele dia concluiu *"não há fonte interna"*.
 *
 * A conclusão estava certa sobre o banco e ERRADA sobre o canal: `entry[].id` é
 * exatamente esse id, e chega em toda notificação da Meta. Ele nunca foi lido porque
 * o tipo do envelope, no próprio arquivo do webhook, declarava só `changes`.
 *
 * Os casos abaixo travam as três coisas que fazem esta peça valer: só reagir ao
 * NOSSO número, nunca inventar id quando ele não vem, e não quebrar o webhook com
 * envelope torto — porque webhook que joga derruba a entrega de mensagem de cliente.
 */

import { describe, it, expect } from "vitest";
import { wabasDaSalaNoEnvelope } from "./route";

const VENDAS = "1300518453142518";

function envelope(entradas: Array<{ id?: unknown; phone?: string }>): unknown {
  return {
    entry: entradas.map((e) => ({
      ...(e.id === undefined ? {} : { id: e.id }),
      changes: e.phone === undefined ? [] : [{ value: { metadata: { phone_number_id: e.phone } } }],
    })),
  };
}

describe("wabasDaSalaNoEnvelope", () => {
  it("acha o id da conta quando a notificação é do número de vendas", () => {
    expect(wabasDaSalaNoEnvelope(envelope([{ id: "204..907", phone: VENDAS }]), VENDAS)).toEqual(["204..907"]);
  });

  it("IGNORA notificação de outro número — é o número de um restaurante, não o nosso", () => {
    expect(wabasDaSalaNoEnvelope(envelope([{ id: "outra-conta", phone: "999999999" }]), VENDAS)).toEqual([]);
  });

  it("não devolve nada quando o envelope veio sem `id` — ausência não vira valor", () => {
    expect(wabasDaSalaNoEnvelope(envelope([{ phone: VENDAS }]), VENDAS)).toEqual([]);
  });

  it("não devolve nada quando o número de vendas não está configurado", () => {
    expect(wabasDaSalaNoEnvelope(envelope([{ id: "204..907", phone: VENDAS }]), null)).toEqual([]);
  });

  it("não repete o mesmo id quando ele vem em mais de uma entrada", () => {
    const dobrado = envelope([{ id: "204..907", phone: VENDAS }, { id: "204..907", phone: VENDAS }]);
    expect(wabasDaSalaNoEnvelope(dobrado, VENDAS)).toEqual(["204..907"]);
  });

  /**
   * ⚠️ Este é o caso que protege o produto, não a Sala: se esta leitura jogar, o
   * webhook inteiro cai — e com ele a mensagem do cliente do restaurante, que não
   * tem nada a ver com prospecção.
   */
  it("aguenta envelope torto sem jogar", () => {
    for (const lixo of [null, undefined, {}, { entry: null }, { entry: [null] }, "texto", 42]) {
      expect(() => wabasDaSalaNoEnvelope(lixo, VENDAS)).not.toThrow();
      expect(wabasDaSalaNoEnvelope(lixo, VENDAS)).toEqual([]);
    }
  });
});
