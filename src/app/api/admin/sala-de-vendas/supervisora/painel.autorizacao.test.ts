import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * A GUARDA DO PAINEL DA SUPERVISORA — as duas metades, sempre.
 *
 * Mesmo molde de `../isolamento.test.ts`: chama as rotas DIRETAMENTE, sem
 * tela, porque é assim que alguém que sabe o endereço chega. O SDR humano
 * nunca alcança este painel (ele compara desempenho de agentes entre si —
 * informação de gestão, não de trabalho do dia); o auditor lê e não decide.
 */

const autorizarInterno = vi.fn();
const criarEvento = vi.fn();
const visaoGeralDaSupervisora = vi.fn();
const conversasEmRisco = vi.fn();
const desempenhoPorAgente = vi.fn();
const rejeitarSugestao = vi.fn();
const aprovarSugestaoECriarVersao = vi.fn();
const publicarVersaoExistente = vi.fn();

vi.mock("@/lib/internal-auth", async () => {
  const real = await vi.importActual<typeof import("@/lib/internal-auth")>("@/lib/internal-auth");
  return { ...real, autorizarInterno: (...a: unknown[]) => autorizarInterno(...a) };
});

vi.mock("@/lib/prisma", () => ({
  prisma: {
    internalAuditEvent: { create: (...a: unknown[]) => criarEvento(...a) },
    internalUser: { findMany: vi.fn().mockResolvedValue([]) },
    supervisoraSugestaoDePrompt: {
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn().mockResolvedValue({ id: "s1", situacao: "PENDENTE" }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    sdrIaConfig: { findUnique: vi.fn().mockResolvedValue({ id: "cfg1", versaoAtivaId: "v1" }) },
    sdrIaConfigVersao: { findMany: vi.fn().mockResolvedValue([]) },
  },
}));

vi.mock("@/services/salaDeVendas/supervisora/painel", () => ({
  visaoGeralDaSupervisora: (...a: unknown[]) => visaoGeralDaSupervisora(...a),
  conversasEmRisco: (...a: unknown[]) => conversasEmRisco(...a),
}));

vi.mock("@/services/salaDeVendas/supervisora/desempenho", async () => {
  const real = await vi.importActual<typeof import("@/services/salaDeVendas/supervisora/desempenho")>(
    "@/services/salaDeVendas/supervisora/desempenho",
  );
  return { ...real, desempenhoPorAgente: (...a: unknown[]) => desempenhoPorAgente(...a) };
});

vi.mock("@/services/salaDeVendas/supervisora/sugestoes", () => ({
  rejeitarSugestao: (...a: unknown[]) => rejeitarSugestao(...a),
  aprovarSugestaoECriarVersao: (...a: unknown[]) => aprovarSugestaoECriarVersao(...a),
}));

vi.mock("@/services/salaDeVendas/ta/interruptor", () => ({
  publicarVersaoExistente: (...a: unknown[]) => publicarVersaoExistente(...a),
}));

const SDR = { userId: "sdr1", nome: "SDR Humano", role: "AGENTE_HUMANO" as const, departamentos: [], gerencia: [] };
const GERENTE = { ...SDR, userId: "ger1", nome: "Gerente", role: "GERENTE_DEPARTAMENTO" as const };
const AUDITOR = { ...SDR, userId: "aud1", nome: "Auditor", role: "AUDITOR_QA" as const };
const CEO = { ...SDR, userId: "ceo1", nome: "CEO", role: "MASTER_CEO" as const };

beforeEach(() => {
  autorizarInterno.mockReset();
  criarEvento.mockReset().mockResolvedValue({});
  visaoGeralDaSupervisora.mockReset().mockResolvedValue({ periodo: {}, principaisRiscos: [], porVeredito: {} });
  conversasEmRisco.mockReset().mockResolvedValue([]);
  desempenhoPorAgente.mockReset().mockResolvedValue([]);
  rejeitarSugestao.mockReset().mockResolvedValue({ ok: true });
  aprovarSugestaoECriarVersao.mockReset().mockResolvedValue({ ok: true, versaoId: "v2", numero: 2 });
  publicarVersaoExistente.mockReset().mockResolvedValue({ ok: true, numero: 2, eraAAtiva: false });
});

const pedidoGET = (url: string) => new NextRequest(`http://localhost${url}`);
const pedidoPOST = (url: string, body: Record<string, unknown>) =>
  new NextRequest(`http://localhost${url}`, { method: "POST", body: JSON.stringify(body) });

describe("as rotas de LEITURA do painel", () => {
  const rotasDeLeitura: Array<{ nome: string; importar: () => Promise<{ GET: (r: NextRequest) => Promise<Response> }>; url: string; servico: ReturnType<typeof vi.fn> }> = [
    { nome: "visao-geral", importar: () => import("./visao-geral/route"), url: "/api/admin/sala-de-vendas/supervisora/visao-geral", servico: visaoGeralDaSupervisora },
    { nome: "conversas-em-risco", importar: () => import("./conversas-em-risco/route"), url: "/api/admin/sala-de-vendas/supervisora/conversas-em-risco", servico: conversasEmRisco },
    { nome: "desempenho", importar: () => import("./desempenho/route"), url: "/api/admin/sala-de-vendas/supervisora/desempenho", servico: desempenhoPorAgente },
  ];

  for (const rota of rotasDeLeitura) {
    it(`${rota.nome}: o SDR humano NÃO entra`, async () => {
      autorizarInterno.mockReturnValue({ ok: false, status: 403, motivo: "papel AGENTE_HUMANO não atende", sessao: SDR });
      const { GET } = await rota.importar();
      const res = await GET(pedidoGET(rota.url));
      expect(res.status).toBe(403);
      expect(rota.servico).not.toHaveBeenCalled();
    });

    it(`${rota.nome}: a exigência de papel nunca inclui AGENTE_HUMANO nem AGENTE_IA`, async () => {
      autorizarInterno.mockReturnValue({ ok: true, sessao: CEO });
      const { GET } = await rota.importar();
      await GET(pedidoGET(rota.url));
      const exigencia = autorizarInterno.mock.calls[0]![1] as { papeis?: string[] };
      expect(exigencia.papeis).not.toContain("AGENTE_HUMANO");
      expect(exigencia.papeis).not.toContain("AGENTE_IA");
      expect(exigencia.papeis).toContain("MASTER_CEO");
    });

    it(`${rota.nome}: o auditor LÊ normalmente`, async () => {
      autorizarInterno.mockReturnValue({ ok: true, sessao: AUDITOR });
      const { GET } = await rota.importar();
      const res = await GET(pedidoGET(rota.url));
      expect(res.status).toBe(200);
      expect(rota.servico).toHaveBeenCalled();
    });

    it(`${rota.nome}: a tentativa negada entra na trilha de auditoria`, async () => {
      autorizarInterno.mockReturnValue({ ok: false, status: 403, motivo: "papel AGENTE_HUMANO não atende", sessao: SDR });
      const { GET } = await rota.importar();
      await GET(pedidoGET(rota.url));
      expect(criarEvento).toHaveBeenCalled();
      const dados = criarEvento.mock.calls[0]![0].data;
      expect(dados.resultado).toBe("NEGADO");
      expect(dados.actorLabel).toContain("sdr1");
    });
  }
});

describe("as rotas de DECISÃO do painel — o auditor lê e não decide", () => {
  it("sugestões: aprovar como MASTER_CEO chama o serviço", async () => {
    autorizarInterno.mockReturnValue({ ok: true, sessao: CEO });
    const { POST } = await import("./sugestoes/route");
    const res = await POST(pedidoPOST("/api/admin/sala-de-vendas/supervisora/sugestoes", { acao: "aprovar", sugestaoId: "s1" }));
    expect(res.status).toBe(200);
    expect(aprovarSugestaoECriarVersao).toHaveBeenCalled();
  });

  it("sugestões: aprovar como AUDITOR_QA responde 403 e NÃO chama o serviço", async () => {
    autorizarInterno.mockReturnValue({ ok: true, sessao: AUDITOR });
    const { POST } = await import("./sugestoes/route");
    const res = await POST(pedidoPOST("/api/admin/sala-de-vendas/supervisora/sugestoes", { acao: "aprovar", sugestaoId: "s1" }));
    expect(res.status).toBe(403);
    expect(aprovarSugestaoECriarVersao).not.toHaveBeenCalled();
  });

  it("sugestões: rejeitar como GERENTE_DEPARTAMENTO chama o serviço", async () => {
    autorizarInterno.mockReturnValue({ ok: true, sessao: GERENTE });
    const { POST } = await import("./sugestoes/route");
    const res = await POST(pedidoPOST("/api/admin/sala-de-vendas/supervisora/sugestoes", { acao: "rejeitar", sugestaoId: "s1" }));
    expect(res.status).toBe(200);
    expect(rejeitarSugestao).toHaveBeenCalled();
  });

  it("sugestões: o SDR humano nem chega na checagem de decisão — a guarda barra antes", async () => {
    autorizarInterno.mockReturnValue({ ok: false, status: 403, motivo: "papel AGENTE_HUMANO não atende", sessao: SDR });
    const { POST } = await import("./sugestoes/route");
    const res = await POST(pedidoPOST("/api/admin/sala-de-vendas/supervisora/sugestoes", { acao: "aprovar", sugestaoId: "s1" }));
    expect(res.status).toBe(403);
    expect(aprovarSugestaoECriarVersao).not.toHaveBeenCalled();
  });

  it("versões: publicar como MASTER_CEO chama publicarVersaoExistente", async () => {
    autorizarInterno.mockReturnValue({ ok: true, sessao: CEO });
    const { POST } = await import("./versoes/route");
    const res = await POST(pedidoPOST("/api/admin/sala-de-vendas/supervisora/versoes", { acao: "publicar", versaoId: "v2" }));
    expect(res.status).toBe(200);
    expect(publicarVersaoExistente).toHaveBeenCalledWith(expect.anything(), { versaoId: "v2", porUserId: "ceo1" });
  });

  it("versões: publicar como AUDITOR_QA responde 403 e NÃO publica nada", async () => {
    autorizarInterno.mockReturnValue({ ok: true, sessao: AUDITOR });
    const { POST } = await import("./versoes/route");
    const res = await POST(pedidoPOST("/api/admin/sala-de-vendas/supervisora/versoes", { acao: "publicar", versaoId: "v2" }));
    expect(res.status).toBe(403);
    expect(publicarVersaoExistente).not.toHaveBeenCalled();
  });
});
