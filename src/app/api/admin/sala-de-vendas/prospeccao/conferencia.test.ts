import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * ?recorte=conferencia — A ROTA, COM AS CHAVES DE AMBIENTE DE VERDADE.
 *
 * ── POR QUE ESTE TESTE NÃO MOCA `FoocciSalesChannel` ────────────────────────
 *
 * O achado da auditoria era exatamente sobre a FIAÇÃO entre a rota e o estado
 * operacional real: a rota lia `canalDeVendasPronto()` — que depende de
 * `FOOCCI_SDR_SEND_ENABLED` — e passava isso para dentro da avaliação de cada
 * contato, fazendo a chave desligada barrar todo mundo. Mocar
 * `isFoocciSalesChannelConfigured`/`isFoocciSdrSendEnabled` aqui provaria só
 * que o dublê funciona — não que a ROTA lê a chave de verdade. Por isso este
 * teste manipula as variáveis de ambiente reais e só moca
 * `conferirElegibilidadeReal`, para inspecionar com que `opcoes` a rota a
 * chamou.
 */

const conferirElegibilidadeReal = vi.fn();
const autorizarInterno = vi.fn();
const criarEvento = vi.fn();

vi.mock("@/lib/internal-auth", async () => {
  const real = await vi.importActual<typeof import("@/lib/internal-auth")>("@/lib/internal-auth");
  return { ...real, autorizarInterno: (...a: unknown[]) => autorizarInterno(...a) };
});

// Só a trilha de auditoria da guarda — não a `conferirElegibilidadeReal`, que
// segue chamando `conferirElegibilidadeReal(prisma, ...)` de verdade (ela é
// mocada abaixo, e nunca chega a tocar o banco).
vi.mock("@/lib/prisma", () => ({
  prisma: { internalAuditEvent: { create: (...a: unknown[]) => criarEvento(...a) } },
}));

vi.mock("@/services/salaDeVendas/prospeccao/selecao", async () => {
  const real = await vi.importActual<typeof import("@/services/salaDeVendas/prospeccao/selecao")>(
    "@/services/salaDeVendas/prospeccao/selecao",
  );
  return {
    ...real,
    conferirElegibilidadeReal: (...a: unknown[]) => conferirElegibilidadeReal(...a),
  };
});

const SDR = {
  userId: "sdr1",
  nome: "SDR Humano",
  role: "AGENTE_HUMANO" as const,
  departamentos: ["vendas"],
  gerencia: [],
};

function pedidoDeConferencia(querystring = ""): NextRequest {
  return new NextRequest(
    `http://localhost/api/admin/sala-de-vendas/prospeccao?recorte=conferencia${querystring}`,
  );
}

const RESULTADO_CANONICO = {
  pendentes: 0,
  elegiveisSeAtivar: 0,
  barrados: 0,
  itensAvaliados: 0,
  varreuTudo: true,
  alvoDeElegiveis: 2000,
  canalConfigurado: false,
  envioAutorizado: false,
  prospeccaoLigada: false,
  usadosHoje: 0,
  tetoDoDia: 0,
  saldoDiario: 0,
  usadosNaJanela: 0,
  saldoDaJanela: 0,
  capacidadeAoAtivar: 0,
  capacidadeOperacionalAgora: 0,
  previaAmostral: [],
};

const ENV_ORIGINAL = { ...process.env };

beforeEach(() => {
  autorizarInterno.mockReset().mockReturnValue({ ok: true, sessao: SDR });
  criarEvento.mockReset().mockResolvedValue({});
  conferirElegibilidadeReal.mockReset().mockResolvedValue(RESULTADO_CANONICO);
  vi.resetModules();
});

afterEach(() => {
  process.env = { ...ENV_ORIGINAL };
});

describe("?recorte=conferencia — 1. rota com FOOCCI_SDR_SEND_ENABLED=false", () => {
  it("⭐⭐⭐ repassa envioAutorizado: false quando a chave está desligada — a fiação que a auditoria cobrou", async () => {
    process.env.FOOCCI_SDR_SEND_ENABLED = "false";
    process.env.FOOCCI_SALES_PHONE_NUMBER_ID = "";
    process.env.FOOCCI_SALES_ACCESS_TOKEN = "";

    const { GET } = await import("./route");
    const res = await GET(pedidoDeConferencia());

    expect(res.status).toBe(200);
    expect(conferirElegibilidadeReal).toHaveBeenCalledTimes(1);
    const opcoes = conferirElegibilidadeReal.mock.calls[0]![1];
    expect(opcoes.envioAutorizado).toBe(false);
    expect(opcoes.canalConfigurado).toBe(false);
  });

  it("com a chave ligada e o canal configurado, os dois chegam `true`", async () => {
    process.env.FOOCCI_SDR_SEND_ENABLED = "true";
    process.env.FOOCCI_SALES_PROVIDER = "META_CLOUD_API";
    process.env.FOOCCI_SALES_PHONE_NUMBER_ID = "123456";
    process.env.FOOCCI_SALES_ACCESS_TOKEN = "token-de-teste";

    const { GET } = await import("./route");
    const res = await GET(pedidoDeConferencia());

    expect(res.status).toBe(200);
    const opcoes = conferirElegibilidadeReal.mock.calls[0]![1];
    expect(opcoes.envioAutorizado).toBe(true);
    expect(opcoes.canalConfigurado).toBe(true);
  });
});

describe("?recorte=conferencia — 7. o parâmetro público ?alvo= é limitado a 2.000", () => {
  it("⛔ ?alvo=999999 chega limitado a 2.000 — não passa a varredura arbitrária adiante", async () => {
    process.env.FOOCCI_SDR_SEND_ENABLED = "false";
    const { GET } = await import("./route");

    await GET(pedidoDeConferencia("&alvo=999999"));

    const opcoes = conferirElegibilidadeReal.mock.calls[0]![1];
    expect(opcoes.alvoDeElegiveis).toBeLessThanOrEqual(2000);
    expect(opcoes.alvoDeElegiveis).toBe(2000);
  });

  it("um ?alvo= dentro do teto é respeitado como pedido", async () => {
    process.env.FOOCCI_SDR_SEND_ENABLED = "false";
    const { GET } = await import("./route");

    await GET(pedidoDeConferencia("&alvo=50"));

    const opcoes = conferirElegibilidadeReal.mock.calls[0]![1];
    expect(opcoes.alvoDeElegiveis).toBe(50);
  });

  it("?alvo= ausente não força nenhum valor — a função usa o próprio padrão", async () => {
    process.env.FOOCCI_SDR_SEND_ENABLED = "false";
    const { GET } = await import("./route");

    await GET(pedidoDeConferencia());

    const opcoes = conferirElegibilidadeReal.mock.calls[0]![1];
    expect(opcoes.alvoDeElegiveis).toBeUndefined();
  });

  it("?alvo= negativo ou zero é ignorado, não vira uma meta inválida", async () => {
    process.env.FOOCCI_SDR_SEND_ENABLED = "false";
    const { GET } = await import("./route");

    await GET(pedidoDeConferencia("&alvo=-5"));

    const opcoes = conferirElegibilidadeReal.mock.calls[0]![1];
    expect(opcoes.alvoDeElegiveis).toBeUndefined();
  });
});

describe("?recorte=conferencia — a porta de entrada", () => {
  it("⛔ quem não tem sessão não alcança a conferência", async () => {
    autorizarInterno.mockReturnValue({ ok: false, sessao: null, motivo: "sem sessão", status: 401 });
    const { GET } = await import("./route");

    const res = await GET(pedidoDeConferencia());

    expect(res.status).toBe(401);
    expect(conferirElegibilidadeReal).not.toHaveBeenCalled();
  });
});
