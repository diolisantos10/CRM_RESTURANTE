import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * QUEM PODE AUTORIZAR A CASA A FALAR COM ESTRANHOS.
 *
 * ── A DISTINÇÃO QUE ESTE ARQUIVO PROTEGE ────────────────────────────────────
 *
 * O SDR **conduz** a prospecção: ele precisa ver a fila do dia, e precisa ver
 * quem foi barrado e por quê. Isso é trabalho dele.
 *
 * **Disparar a rodada e mexer no interruptor não são.** São o ato de autorizar
 * a empresa a abordar gente que nunca pediu nada — e esse ato responde por
 * danos que o SDR não tem como avaliar: número restringido, denúncia, marca
 * queimada. (Até 10/09/2026 "liberar um lote" também exigia isso; a operação
 * por lotes foi removida em 11/09/2026 — ver `route.ts`.)
 *
 * A tela já esconde os botões de quem não pode. Menu escondido não é
 * autorização: quem souber o endereço manda o POST na mão. Por isso estes testes
 * chamam a rota DIRETAMENTE.
 *
 * As duas metades, sempre. Um teste só da recusa não separa nada — passaria
 * numa rota trancada para todo mundo, inclusive para quem deveria entrar.
 */

const autorizarInterno = vi.fn();
const criarEvento = vi.fn();
const abordarARodadaDoDia = vi.fn();
const upsertConfig = vi.fn();
const lerConfig = vi.fn();

vi.mock("@/lib/internal-auth", async () => {
  const real = await vi.importActual<typeof import("@/lib/internal-auth")>("@/lib/internal-auth");
  return { ...real, autorizarInterno: (...a: unknown[]) => autorizarInterno(...a) };
});

vi.mock("@/lib/prisma", () => ({
  prisma: {
    internalAuditEvent: { create: (...a: unknown[]) => criarEvento(...a) },
    prospeccaoConfig: {
      upsert: (...a: unknown[]) => upsertConfig(...a),
      findUnique: (...a: unknown[]) => lerConfig(...a),
    },
  },
}));

vi.mock("@/services/salaDeVendas/prospeccao/abordarDaFila", async () => {
  const real = await vi.importActual<
    typeof import("@/services/salaDeVendas/prospeccao/abordarDaFila")
  >("@/services/salaDeVendas/prospeccao/abordarDaFila");
  return { ...real, abordarARodadaDoDia: (...a: unknown[]) => abordarARodadaDoDia(...a) };
});

const SDR = {
  userId: "sdr1",
  nome: "SDR Humano",
  role: "AGENTE_HUMANO" as const,
  departamentos: ["vendas"],
  gerencia: [],
};

const DIRETOR = {
  userId: "d1",
  nome: "Diretor",
  role: "DIRETOR_FOOCCI" as const,
  departamentos: ["vendas"],
  gerencia: ["vendas"],
};

const AUDITOR = {
  userId: "a1",
  nome: "Auditor",
  role: "AUDITOR_QA" as const,
  departamentos: ["vendas"],
  gerencia: [],
};

function pedido(corpo: unknown): NextRequest {
  return new NextRequest("http://localhost/api/admin/sala-de-vendas/prospeccao", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(corpo),
  });
}

beforeEach(() => {
  autorizarInterno.mockReset();
  criarEvento.mockReset().mockResolvedValue({});
  abordarARodadaDoDia.mockReset().mockResolvedValue({
    abordados: 0,
    pulados: 0,
    parouPor: "filaAcabou",
    falha: null,
    extrato: [],
  });
  upsertConfig.mockReset().mockResolvedValue({ id: "singleton", outboundLigado: true });
  // Teto já configurado: o caso comum. Os testes que exercitam o teto zero
  // sobrescrevem este valor explicitamente.
  lerConfig.mockReset().mockResolvedValue({ id: "singleton", limiteDiario: 20 });
});

describe("disparar a rodada", () => {
  it("⛔ o SDR humano NÃO dispara a rodada — ele conduz, não autoriza", async () => {
    autorizarInterno.mockReturnValue({ ok: true, sessao: SDR });
    const { POST } = await import("./route");

    const res = await POST(pedido({ acao: "rodada" }));

    expect(res.status).toBe(403);
    // A trava tem que barrar ANTES de chamar o serviço: um 403 devolvido depois
    // de a rodada já ter falado com gente seria uma mensagem de erro por cima
    // de um fato consumado.
    expect(abordarARodadaDoDia).not.toHaveBeenCalled();
  });

  it("o Diretor dispara", async () => {
    autorizarInterno.mockReturnValue({ ok: true, sessao: DIRETOR });
    const { POST } = await import("./route");

    const res = await POST(pedido({ acao: "rodada" }));

    expect(res.status).toBe(200);
    expect(abordarARodadaDoDia).toHaveBeenCalled();
  });
});

describe("o interruptor da prospecção", () => {
  it("⛔ o SDR humano NÃO liga a prospecção", async () => {
    autorizarInterno.mockReturnValue({ ok: true, sessao: SDR });
    const { POST } = await import("./route");

    const res = await POST(pedido({ acao: "interruptor", ligado: true }));

    expect(res.status).toBe(403);
    expect(upsertConfig).not.toHaveBeenCalled();
  });

  it("⛔ o auditor lê e não escreve — nem para ligar, nem para pausar", async () => {
    autorizarInterno.mockReturnValue({ ok: true, sessao: AUDITOR });
    const { POST } = await import("./route");

    const res = await POST(pedido({ acao: "interruptor", ligado: true }));

    expect(res.status).toBe(403);
    expect(upsertConfig).not.toHaveBeenCalled();
  });

  it("o Diretor liga, e o que é gravado diz QUEM ligou", async () => {
    autorizarInterno.mockReturnValue({ ok: true, sessao: DIRETOR });
    const { POST } = await import("./route");

    const res = await POST(pedido({ acao: "interruptor", ligado: true }));

    expect(res.status).toBe(200);
    const dados = upsertConfig.mock.calls[0]![0].update;
    expect(dados.outboundLigado).toBe(true);
    expect(dados.atualizadoPor).toContain("Diretor");
  });

  it("⛔ ligar com teto zero é recusado — ligar nada não é ligar", async () => {
    // O padrão do campo é 0. Aceitar ligar assim devolveria fila vazia para
    // sempre, e o dono concluiria que o produto está quebrado quando ele estaria
    // obedecendo. A recusa explica o que fazer.
    autorizarInterno.mockReturnValue({ ok: true, sessao: DIRETOR });
    lerConfig.mockResolvedValue({ id: "singleton", limiteDiario: 0 });
    const { POST } = await import("./route");

    const res = await POST(pedido({ acao: "interruptor", ligado: true }));

    expect(res.status).toBe(400);
    expect(upsertConfig).not.toHaveBeenCalled();
  });

  it("ligar informando o teto no mesmo pedido passa, mesmo com o banco em zero", async () => {
    autorizarInterno.mockReturnValue({ ok: true, sessao: DIRETOR });
    lerConfig.mockResolvedValue({ id: "singleton", limiteDiario: 0 });
    const { POST } = await import("./route");

    const res = await POST(pedido({ acao: "interruptor", ligado: true, limiteDiario: 10 }));

    expect(res.status).toBe(200);
    expect(upsertConfig.mock.calls[0]![0].update.limiteDiario).toBe(10);
  });

  it("⭐ pausar DESLIGA, mesmo se o corpo pedir para ligar ao mesmo tempo", async () => {
    // O corpo contraditório existe: um clique duplo, um formulário mal montado,
    // uma chamada refeita. Entre ligar e parar, a resposta segura é parar —
    // e o teste existe para que ninguém "simplifique" essa precedência depois.
    autorizarInterno.mockReturnValue({ ok: true, sessao: DIRETOR });
    const { POST } = await import("./route");

    await POST(pedido({ acao: "interruptor", ligado: true, pausar: true }));

    const dados = upsertConfig.mock.calls[0]![0].update;
    expect(dados.outboundLigado).toBe(false);
    expect(dados.pausadoEm).toBeInstanceOf(Date);
  });
});

describe("a porta de entrada", () => {
  it("⛔ quem não tem sessão não alcança a rota", async () => {
    autorizarInterno.mockReturnValue({
      ok: false,
      sessao: null,
      motivo: "sem sessão",
      status: 401,
    });
    const { POST } = await import("./route");

    const res = await POST(pedido({ acao: "rodada" }));

    expect(res.status).toBe(401);
    expect(abordarARodadaDoDia).not.toHaveBeenCalled();
  });
});
