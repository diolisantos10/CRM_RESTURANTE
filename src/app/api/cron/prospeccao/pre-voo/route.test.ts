/**
 * O pré-voo sozinho: fail-closed, e NÃO fala com ninguém.
 *
 * ⚠️ Esta rota existe porque descobrir que o pré-voo estava cego custou SEIS
 * contatos de uma lista de 4.000, em 08/09/2026 — a única forma de executá-lo
 * era disparando a rodada inteira. A peça que evita gasto não pode ser
 * testável só gastando.
 *
 * O caso que mais importa aqui é o último: **nada de envio é chamado.**
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

const modelos = vi.hoisted(() => ({ preVooDoModelo: vi.fn(), modelosDaSala: vi.fn() }));
vi.mock("@/services/foocci-sdr/modelosDaMeta", () => modelos);

const canal = vi.hoisted(() => ({
  canalDeVendasPronto: vi.fn(() => true),
  isFoocciSdrSendEnabled: vi.fn(() => true),
  iaRespondeSozinha: vi.fn(() => false),
}));
vi.mock("@/services/foocci-sdr/FoocciSalesChannel", () => canal);

// O banco, só leitura: o raio-x conta lotes e itens e lê os dois interruptores.
const banco = vi.hoisted(() => ({
  prisma: {
    prospeccaoConfig: { findUnique: vi.fn() },
    sdrIaConfig: { findUnique: vi.fn() },
    loteDeProspeccao: { groupBy: vi.fn() },
    itemDeProspeccao: { count: vi.fn() },
  },
}));
vi.mock("@/lib/prisma", () => banco);

const rodada = vi.hoisted(() => ({ abordarARodadaDoDia: vi.fn(), abordarItemDaFila: vi.fn() }));
vi.mock("@/services/salaDeVendas/prospeccao/abordarDaFila", () => rodada);

import { POST } from "./route";

const guardado = { ...process.env };

function bater(auth?: string) {
  return POST(
    new NextRequest("https://foocci.com.br/api/cron/prospeccao/pre-voo", {
      method: "POST",
      headers: { "content-type": "application/json", ...(auth ? { authorization: auth } : {}) },
      body: "{}",
    }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.CRON_SECRET = "segredo";
  process.env.FOOCCI_SDR_MODELO_ABORDAGEM = "foocci_abordagem_v1";
  process.env.FOOCCI_SDR_MODELO_IDIOMA = "pt_BR";
  canal.canalDeVendasPronto.mockReturnValue(true);
  modelos.modelosDaSala.mockResolvedValue({
    ok: true,
    modelos: [{ nome: "foocci_abordagem_v1", idioma: "pt_BR", status: "APPROVED", variaveis: 1, corpo: "Olá {{1}}!" }],
  });
  banco.prisma.prospeccaoConfig.findUnique.mockResolvedValue({
    outboundLigado: true, pausadoEm: null, motivo: null, limiteDiario: 10, horasEntreAbordagens: 72,
  });
  banco.prisma.sdrIaConfig.findUnique.mockResolvedValue({ ligado: true, versaoAtivaId: "v1" });
  banco.prisma.loteDeProspeccao.groupBy.mockResolvedValue([{ situacao: "RASCUNHO", _count: { _all: 9 } }]);
  banco.prisma.itemDeProspeccao.count.mockResolvedValue(0);
  modelos.preVooDoModelo.mockResolvedValue({
    pronto: true,
    modelo: { nome: "foocci_abordagem_v1", idioma: "pt_BR", status: "APPROVED", variaveis: 1 },
    parametrosQueMandamos: 1,
  });
});
afterEach(() => { process.env = { ...guardado }; });

describe("a guarda", () => {
  it("⭐ sem CRON_SECRET: 503, e não confere nada", async () => {
    delete process.env.CRON_SECRET;
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await bater("Bearer qualquer");
    expect(res.status).toBe(503);
    expect(modelos.preVooDoModelo).not.toHaveBeenCalled();
  });

  it("segredo errado: 401", async () => {
    const res = await bater("Bearer errado");
    expect(res.status).toBe(401);
    expect(modelos.preVooDoModelo).not.toHaveBeenCalled();
  });
});

describe("o veredito", () => {
  it("devolve a conferência inteira, com o modelo configurado ao lado", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const res = await bater("Bearer segredo");
    const json = (await res.json()) as { data: Record<string, unknown> };

    expect(res.status).toBe(200);
    expect(json.data).toMatchObject({
      modeloConfigurado: { nome: "foocci_abordagem_v1", idioma: "pt_BR" },
      canalPronto: true,
      conferencia: { pronto: true },
    });
  });

  it("reprovação sobe inteira — causa e detalhe, não só 'não pronto'", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    modelos.preVooDoModelo.mockResolvedValue({
      pronto: false,
      causa: "variaveisNaoBatem",
      detalhe: "o modelo espera 3 variáveis e o envio manda 1",
    });

    const res = await bater("Bearer segredo");
    const json = (await res.json()) as { data: { conferencia: Record<string, unknown> } };

    expect(json.data.conferencia).toMatchObject({
      causa: "variaveisNaoBatem",
      detalhe: "o modelo espera 3 variáveis e o envio manda 1",
    });
  });

  it("modelo sem nome configurado aparece como `null`, e não como string vazia", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    delete process.env.FOOCCI_SDR_MODELO_ABORDAGEM;

    const res = await bater("Bearer segredo");
    const json = (await res.json()) as { data: { modeloConfigurado: { nome: unknown } } };

    expect(json.data.modeloConfigurado.nome).toBeNull();
  });
});

describe("⭐ o raio-x (10/09/2026): o que impede envio real hoje, medido", () => {
  it("devolve os modelos com o corpo, os interruptores e a fila contada", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const res = await bater("Bearer segredo");
    const json = (await res.json()) as { data: Record<string, unknown> };

    expect(json.data.modelos).toEqual([
      expect.objectContaining({ nome: "foocci_abordagem_v1", variaveis: 1, corpo: "Olá {{1}}!" }),
    ]);
    expect(json.data.interruptores).toMatchObject({
      envioLigado: true,
      iaRespondeSozinha: false,
      prospeccao: { leitura: "ok", existe: true, ligada: true, limiteDiario: 10 },
      ta: { leitura: "ok", ligado: true, temVersaoPublicada: true },
    });
    expect(json.data.fila).toEqual({
      lotesPorSituacao: { RASCUNHO: 9 },
      itensPendentesEmLoteLiberado: 0,
      itensPendentesNoTotal: 0,
    });
  });

  it("prospecção PAUSADA é dita como desligada — pausa é trava, não detalhe", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    banco.prisma.prospeccaoConfig.findUnique.mockResolvedValue({
      outboundLigado: true, pausadoEm: new Date("2026-09-10T12:00:00Z"), motivo: "aguardando o vai", limiteDiario: 10, horasEntreAbordagens: 72,
    });
    const res = await bater("Bearer segredo");
    const json = (await res.json()) as { data: { interruptores: { prospeccao: Record<string, unknown> } } };
    expect(json.data.interruptores.prospeccao).toMatchObject({ ligada: false, motivo: "aguardando o vai" });
  });

  it("sem configuração no banco a resposta é 'desligada, teto zero' — nunca 'sem limite' (guardrail 1)", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    banco.prisma.prospeccaoConfig.findUnique.mockResolvedValue(null);
    const res = await bater("Bearer segredo");
    const json = (await res.json()) as { data: { interruptores: { prospeccao: Record<string, unknown> } } };
    expect(json.data.interruptores.prospeccao).toEqual({ leitura: "ok", existe: false, ligada: false, pausadaEm: null, limiteDiario: 0 });
  });

  it("leitura do banco que falha vira `leitura: falhou`, e a Meta continua respondendo", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    banco.prisma.prospeccaoConfig.findUnique.mockRejectedValue(new Error("banco fora"));
    banco.prisma.loteDeProspeccao.groupBy.mockRejectedValue(new Error("banco fora"));
    const res = await bater("Bearer segredo");
    const json = (await res.json()) as { data: { interruptores: { prospeccao: unknown }; fila: { lotesPorSituacao: unknown }; conferencia: unknown } };
    expect(res.status).toBe(200);
    expect(json.data.interruptores.prospeccao).toEqual({ leitura: "falhou" });
    expect(json.data.fila.lotesPorSituacao).toBe("leitura falhou");
    expect(json.data.conferencia).toMatchObject({ pronto: true });
  });

  it("a Meta que não lista vira `{ erro }`, nunca lista vazia", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    modelos.modelosDaSala.mockResolvedValue({ ok: false, erro: "token vencido" });
    const res = await bater("Bearer segredo");
    const json = (await res.json()) as { data: { modelos: unknown } };
    expect(json.data.modelos).toEqual({ erro: "token vencido" });
  });
});

describe("⭐ e ela NÃO fala com ninguém", () => {
  it("não monta rodada, não aborda item — nenhum contato é gasto", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    await bater("Bearer segredo");

    expect(rodada.abordarARodadaDoDia, "a leitura virou envio").not.toHaveBeenCalled();
    expect(rodada.abordarItemDaFila, "a leitura virou envio").not.toHaveBeenCalled();
  });
});
