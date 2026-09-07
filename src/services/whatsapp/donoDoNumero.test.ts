/**
 * "De quem é este número?" — e as duas respostas que não podem ser confundidas.
 *
 * A pior delas seria transformar "não está na minha base" em "não é de ninguém".
 * Foi metade do defeito de 06/09/2026: um número que não parecia de ninguém
 * estava configurado como nosso, e era de um cliente.
 */

import { describe, it, expect } from "vitest";
import { deQuemEONumero, pareceIdDeNumero } from "./donoDoNumero";

function banco(linha: unknown) {
  const visto: { where?: unknown; select?: unknown } = {};
  return {
    visto,
    db: {
      metaWhatsAppConfig: {
        findUnique: async (args: { where: unknown; select: unknown }) => {
          visto.where = args.where;
          visto.select = args.select;
          return linha as never;
        },
      },
    },
  };
}

const LINHA = {
  restaurantId: "r1",
  wabaId: "998877",
  displayPhoneNumber: "+55 11 90000-0000",
  connectionStatus: "CONNECTED",
  coexistence: true,
  restaurant: { id: "r1", name: "Sushi Cazza", isActive: true },
};

describe("o número é de um restaurante", () => {
  it("responde com o nome, que é o que se precisa para avisar alguém", async () => {
    const { db } = banco(LINHA);
    const r = await deQuemEONumero(db, "1300518453142518", null);

    expect(r.achado).toBe(true);
    expect(r.achado === true && r.restaurante.nome).toBe("Sushi Cazza");
    expect(r.achado === true && r.numeroVisivel).toBe("+55 11 90000-0000");
  });

  it("⛔ avisa quando o número do cliente É o que está configurado como nosso", async () => {
    // Exatamente o estado de 06/09/2026. Esta é a linha que, sozinha, teria
    // dado o diagnóstico em segundos.
    const { db } = banco(LINHA);
    const r = await deQuemEONumero(db, "1300518453142518", "1300518453142518");

    expect(r.ehONumeroDeVendasConfigurado).toBe(true);
    expect(r.achado === true && r.restaurante.nome).toBe("Sushi Cazza");
  });

  it("sonda de controle: número diferente do configurado NÃO acende o alerta", async () => {
    // Sem esta, o campo poderia estar fixo em `true` e os dois testes acima
    // continuariam verdes.
    const { db } = banco(LINHA);
    const r = await deQuemEONumero(db, "1300518453142518", "1275456615648278");
    expect(r.ehONumeroDeVendasConfigurado).toBe(false);
  });

  it("nunca devolve token, nem cifrado", async () => {
    const { db, visto } = banco(LINHA);
    const r = await deQuemEONumero(db, "1300518453142518", null);

    const pedido = JSON.stringify(visto.select);
    expect(pedido).not.toContain("accessToken");
    expect(pedido).not.toContain("webhookVerifyToken");
    expect(JSON.stringify(r).toLowerCase()).not.toContain("token");
  });
});

describe("o número não está na base", () => {
  it("⛔ diz 'não está aqui', e NUNCA 'não é de ninguém'", async () => {
    const { db } = banco(null);
    const r = await deQuemEONumero(db, "999999999999", null);

    expect(r.achado).toBe(false);
    expect(r.achado === false && r.observacao).toContain("NÃO prova");
  });

  it("config órfã (sem restaurante) conta como não achado, e não estoura", async () => {
    const { db } = banco({ ...LINHA, restaurant: null });
    const r = await deQuemEONumero(db, "999999999999", null);
    expect(r.achado).toBe(false);
  });

  it("mesmo sem achar, ainda diz se o id é o configurado como nosso", async () => {
    // O caso perigoso: o número de vendas configurado não existe em base
    // nenhuma. Perder essa informação porque "não achou" esconderia o problema.
    const { db } = banco(null);
    const r = await deQuemEONumero(db, "555", "555");
    expect(r.ehONumeroDeVendasConfigurado).toBe(true);
  });
});

describe("o formato do id", () => {
  it("aceita o que a Graph API usa", () => {
    expect(pareceIdDeNumero("1300518453142518")).toBe(true);
    expect(pareceIdDeNumero("1275456615648278")).toBe(true);
  });

  it("recusa o que não é id", () => {
    for (const v of ["", "abc", "12", "+5511900000000", "13005184531425181234567", "1300 5184"]) {
      expect(pareceIdDeNumero(v), `"${v}" não é id`).toBe(false);
    }
  });
});
