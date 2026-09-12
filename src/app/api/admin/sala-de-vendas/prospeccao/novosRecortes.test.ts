import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * OS TRÊS NOVOS RECORTES DE LEITURA DO REDESENHO MINIMALISTA, 12/09/2026 —
 * `?recorte=preVoo`, `?recorte=canal`, `?recorte=funil`.
 *
 * Os três só ABREM leituras que já existiam e já eram testadas
 * (`preVooDoModelo`, `conferirCanalDeVendas`, `funilPorModelo`,
 * `modelosSincronizadosDaSala`) para quem está logado na tela — sem exigir
 * `CRON_SECRET` (que é o guarda de `/api/cron/prospeccao/pre-voo`) e sem gastar
 * um contato para descobrir o estado do modelo. Nenhuma escrita em nenhum dos
 * três: por isso este arquivo moca as funções e prova só a FIAÇÃO — que a
 * rota chama a função certa e devolve o que ela respondeu, atrás da mesma
 * guarda de sessão das outras leituras.
 */

const preVooDoModelo = vi.fn();
const conferirCanalDeVendas = vi.fn();
const funilPorModelo = vi.fn();
const modelosSincronizadosDaSala = vi.fn();
const autorizarInterno = vi.fn();
const criarEvento = vi.fn();

vi.mock("@/lib/internal-auth", async () => {
  const real = await vi.importActual<typeof import("@/lib/internal-auth")>("@/lib/internal-auth");
  return { ...real, autorizarInterno: (...a: unknown[]) => autorizarInterno(...a) };
});

vi.mock("@/lib/prisma", () => ({
  prisma: { internalAuditEvent: { create: (...a: unknown[]) => criarEvento(...a) } },
}));

vi.mock("@/services/foocci-sdr/modelosDaMeta", async () => {
  const real = await vi.importActual<typeof import("@/services/foocci-sdr/modelosDaMeta")>(
    "@/services/foocci-sdr/modelosDaMeta",
  );
  return { ...real, preVooDoModelo: (...a: unknown[]) => preVooDoModelo(...a) };
});

vi.mock("@/services/foocci-sdr/FoocciSalesChannel", async () => {
  const real = await vi.importActual<typeof import("@/services/foocci-sdr/FoocciSalesChannel")>(
    "@/services/foocci-sdr/FoocciSalesChannel",
  );
  return { ...real, conferirCanalDeVendas: (...a: unknown[]) => conferirCanalDeVendas(...a) };
});

vi.mock("@/services/foocci-sdr/funilDoModelo", async () => {
  const real = await vi.importActual<typeof import("@/services/foocci-sdr/funilDoModelo")>(
    "@/services/foocci-sdr/funilDoModelo",
  );
  return { ...real, funilPorModelo: (...a: unknown[]) => funilPorModelo(...a) };
});

vi.mock("@/services/foocci-sdr/sincronizarModelos", async () => {
  const real = await vi.importActual<typeof import("@/services/foocci-sdr/sincronizarModelos")>(
    "@/services/foocci-sdr/sincronizarModelos",
  );
  return {
    ...real,
    modelosSincronizadosDaSala: (...a: unknown[]) => modelosSincronizadosDaSala(...a),
  };
});

const SDR = {
  userId: "sdr1",
  nome: "SDR Humano",
  role: "AGENTE_HUMANO" as const,
  departamentos: ["vendas"],
  gerencia: [],
};

function pedido(recorte: string): NextRequest {
  return new NextRequest(`http://localhost/api/admin/sala-de-vendas/prospeccao?recorte=${recorte}`);
}

beforeEach(() => {
  autorizarInterno.mockReset().mockReturnValue({ ok: true, sessao: SDR });
  criarEvento.mockReset().mockResolvedValue({});
  preVooDoModelo.mockReset();
  conferirCanalDeVendas.mockReset();
  funilPorModelo.mockReset().mockResolvedValue([]);
  modelosSincronizadosDaSala.mockReset().mockResolvedValue([]);
  vi.resetModules();
});

describe("?recorte=preVoo", () => {
  it("devolve exatamente o veredito de preVooDoModelo, sem gastar contato", async () => {
    preVooDoModelo.mockResolvedValue({
      pronto: false,
      causa: "naoAutorizado",
      detalhe: "não autorizado internamente",
    });
    const { GET } = await import("./route");

    const res = await GET(pedido("preVoo"));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(preVooDoModelo).toHaveBeenCalledTimes(1);
    expect(json).toEqual({
      ok: true,
      data: { pronto: false, causa: "naoAutorizado", detalhe: "não autorizado internamente" },
    });
  });

  it("sem sessão, não chega a chamar o pré-voo", async () => {
    autorizarInterno.mockReturnValue({ ok: false, sessao: null, motivo: "sem sessão", status: 401 });
    const { GET } = await import("./route");

    const res = await GET(pedido("preVoo"));

    expect(res.status).toBe(401);
    expect(preVooDoModelo).not.toHaveBeenCalled();
  });
});

describe("?recorte=canal", () => {
  it("devolve exatamente o veredito de conferirCanalDeVendas", async () => {
    conferirCanalDeVendas.mockResolvedValue({
      ok: false,
      causa: "aMetaRecusou",
      detalhe: "token inválido",
    });
    const { GET } = await import("./route");

    const res = await GET(pedido("canal"));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(conferirCanalDeVendas).toHaveBeenCalledTimes(1);
    expect(json.data).toEqual({ ok: false, causa: "aMetaRecusou", detalhe: "token inválido" });
  });

  it("sem sessão, não chega a chamar a Meta", async () => {
    autorizarInterno.mockReturnValue({ ok: false, sessao: null, motivo: "sem sessão", status: 401 });
    const { GET } = await import("./route");

    const res = await GET(pedido("canal"));

    expect(res.status).toBe(401);
    expect(conferirCanalDeVendas).not.toHaveBeenCalled();
  });
});

describe("?recorte=funil", () => {
  it("devolve o funil por modelo e os modelos persistidos juntos", async () => {
    funilPorModelo.mockResolvedValue([
      { templateNome: "abordagem_restaurante_fria", tentativas: 10, enviados: 8, entregues: 6, lidos: 4, falharam: 2, respondidos: 2, comRespostaPositiva: 1, optOut: 0 },
    ]);
    modelosSincronizadosDaSala.mockResolvedValue([
      { nome: "abordagem_restaurante_fria", idioma: "pt_BR", categoria: "MARKETING", situacao: "APPROVED", variaveis: 1, corpo: "…", autorizado: true },
    ]);
    const { GET } = await import("./route");

    const res = await GET(pedido("funil"));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(funilPorModelo).toHaveBeenCalledTimes(1);
    expect(modelosSincronizadosDaSala).toHaveBeenCalledTimes(1);
    expect(json.data.funil).toHaveLength(1);
    expect(json.data.modelos).toHaveLength(1);
    expect(json.data.modelos[0].autorizado).toBe(true);
  });

  it("sem sessão, não chega a consultar nada", async () => {
    autorizarInterno.mockReturnValue({ ok: false, sessao: null, motivo: "sem sessão", status: 401 });
    const { GET } = await import("./route");

    const res = await GET(pedido("funil"));

    expect(res.status).toBe(401);
    expect(funilPorModelo).not.toHaveBeenCalled();
    expect(modelosSincronizadosDaSala).not.toHaveBeenCalled();
  });
});
