/**
 * O gatilho das 9h: fail-closed, e SISTEMA como quem manda.
 *
 * ⚠️ A guarda é o oposto do `if (secret) { ... }` que a varredura de segurança
 * encontrou em `cron/expire-wa-ordering-sessions`, onde a ausência da variável
 * ABRE a porta. Aqui ausência é recusa.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

const rodada = vi.hoisted(() => ({ abordarARodadaDoDia: vi.fn() }));
vi.mock("@/services/salaDeVendas/prospeccao/abordarDaFila", () => rodada);
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/services/foocci-sdr/FoocciSalesChannel", () => ({ canalDeVendasPronto: () => true }));

import { POST } from "./route";

const guardado = { ...process.env };

function bater(auth?: string, corpo: unknown = {}) {
  return POST(
    new NextRequest("https://foocci.com.br/api/cron/prospeccao/rodada", {
      method: "POST",
      headers: { "content-type": "application/json", ...(auth ? { authorization: auth } : {}) },
      body: JSON.stringify(corpo),
    }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.CRON_SECRET = "segredo";
  rodada.abordarARodadaDoDia.mockResolvedValue({
    abordados: 2, pulados: 1, parouPor: "filaAcabou", falha: null, extrato: [],
  });
});
afterEach(() => { process.env = { ...guardado }; });

describe("a guarda", () => {
  it("⭐ sem CRON_SECRET: 503, e a rodada NÃO roda", async () => {
    delete process.env.CRON_SECRET;
    const res = await bater("Bearer qualquer");
    expect(res.status).toBe(503);
    expect(rodada.abordarARodadaDoDia).not.toHaveBeenCalled();
  });

  it("segredo errado: 401, e a rodada NÃO roda", async () => {
    const res = await bater("Bearer errado");
    expect(res.status).toBe(401);
    expect(rodada.abordarARodadaDoDia).not.toHaveBeenCalled();
  });

  it("sem cabeçalho nenhum: 401", async () => {
    expect((await bater()).status).toBe(401);
  });
});

describe("a rodada", () => {
  it("⭐ A METADE LEGÍTIMA: com o segredo certo, ela roda como SISTEMA", async () => {
    const res = await bater("Bearer segredo");

    expect(res.status).toBe(200);
    expect(rodada.abordarARodadaDoDia).toHaveBeenCalledTimes(1);
    expect(rodada.abordarARodadaDoDia.mock.calls[0][1]).toMatchObject({
      autor: "SISTEMA",
      canalPronto: true,
    });
  });

  it("⭐ NÃO manda autorUserId — quem responde é quem liberou o lote", async () => {
    await bater("Bearer segredo");
    expect(rodada.abordarARodadaDoDia.mock.calls[0][1]).not.toHaveProperty("autorUserId");
  });

  it("o teto do corpo chega à rodada", async () => {
    await bater("Bearer segredo", { teto: 10 });
    expect(rodada.abordarARodadaDoDia.mock.calls[0][1]).toMatchObject({ teto: 10 });
  });

  it("teto inválido é ignorado, e não vira zero", async () => {
    // `teto: 0` desligaria a rodada em silêncio. Vale mais ignorar e usar o
    // teto do dia do banco do que aceitar um número que ninguém quis dizer.
    await bater("Bearer segredo", { teto: 0 });
    expect(rodada.abordarARodadaDoDia.mock.calls[0][1]).not.toHaveProperty("teto");
  });

  it("devolve o extrato para quem agendou", async () => {
    const json = await (await bater("Bearer segredo")).json();
    expect(json.data).toMatchObject({ abordados: 2, pulados: 1, parouPor: "filaAcabou" });
  });
});

/**
 * ⭐ A LIGAÇÃO, e não só a peça.
 *
 * A doença crônica desta casa é *peça pronta, ninguém chamando* — quatro vezes
 * só em 08/09. O pré-voo é um parâmetro obrigatório, então esquecer não compila;
 * mas passar uma função qualquer compila. Este caso trava que a rota manda **a
 * conferência de verdade**, e não um stub que aprova tudo.
 */
describe("o gatilho leva o pré-voo do modelo — não uma função qualquer", () => {
  it("passa `preVooDoModelo`, o mesmo que lê a Meta", async () => {
    const { preVooDoModelo } = await import("@/services/foocci-sdr/modelosDaMeta");

    await bater("Bearer segredo");

    const params = rodada.abordarARodadaDoDia.mock.calls[0][1] as { preVoo: unknown };
    expect(params.preVoo, "a rodada das 9h roda sem conferir o modelo").toBe(preVooDoModelo);
  });
});
