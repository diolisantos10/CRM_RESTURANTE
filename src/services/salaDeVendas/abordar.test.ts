/**
 * A ponte, medida.
 *
 * O que estes casos protegem, em ordem de gravidade:
 *
 *   1. **A ordem das travas.** Portão do lead antes do freio: recusar por
 *      ritmo alguém que nem podia ser abordado esconderia o motivo verdadeiro.
 *   2. **Gravar antes de enviar.** O pior caso tem de ser uma linha visível, e
 *      nunca um cliente que recebeu sem o sistema saber.
 *   3. **A recusa da Meta fica escrita na linha.** Falha silenciosa aqui faz o
 *      vendedor esperar resposta de uma mensagem que nunca saiu.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { abordarLead, primeiroNome, resumoDoModelo, modeloConfigurado } from "./abordar";

const enviarModelo = vi.hoisted(() => vi.fn());
const canalPronto = vi.hoisted(() => vi.fn(() => true));

vi.mock("@/services/foocci-sdr/FoocciSalesChannel", async (original) => {
  const real = await original<typeof import("@/services/foocci-sdr/FoocciSalesChannel")>();
  return { ...real, enviarModeloDeVendas: enviarModelo, canalDeVendasPronto: canalPronto };
});

const ambiente = { ...process.env };

const LEAD = {
  id: "L1",
  nome: "Marina Gambarini",
  whatsapp: "+5511999998888",
  optOutAt: null as Date | null,
  consentAt: new Date("2026-09-01T10:00:00Z"),
  createdAt: new Date("2026-09-01T10:00:00Z"),
  lastContactedAt: null as Date | null,
};

const AGORA = new Date("2026-09-07T13:00:00Z");

function banco(over: {
  lead?: Partial<typeof LEAD> | null;
  tentativas?: number;
  jaSairam?: number;
} = {}) {
  const gravadas: Array<Record<string, unknown>> = [];
  const atualizadas: Array<Record<string, unknown>> = [];
  /** `registrarSaida` também carimba `lastContactedAt` no lead. */
  const carimbos: Array<Record<string, unknown>> = [];

  return {
    gravadas,
    atualizadas,
    carimbos,
    db: {
      siteLead: {
        findUnique: async () =>
          over.lead === null ? null : { ...LEAD, ...(over.lead ?? {}) },
        update: async (args: { data: Record<string, unknown> }) => {
          carimbos.push(args.data);
          return {};
        },
      },
      leadMensagem: {
        count: async (args: { where: { tipo?: string } }) =>
          // A ponte conta duas coisas diferentes com o mesmo `count`: as
          // tentativas anteriores (sem `tipo`) e o ritmo (com `tipo: TEMPLATE`).
          args.where.tipo === "TEMPLATE" ? (over.jaSairam ?? 0) : (over.tentativas ?? 0),
        create: async (args: { data: Record<string, unknown> }) => {
          gravadas.push(args.data);
          return { id: "m1" };
        },
        update: async (args: { data: Record<string, unknown> }) => {
          atualizadas.push(args.data);
          return {};
        },
      },
    } as never,
  };
}

beforeEach(() => {
  enviarModelo.mockReset();
  enviarModelo.mockResolvedValue({ ok: true });
  canalPronto.mockReturnValue(true);
  process.env.FOOCCI_SDR_MODELO_ABORDAGEM = "foocci_abordagem_inicial";
  process.env.FOOCCI_SDR_MODELO_IDIOMA = "pt_BR";
});

afterEach(() => {
  process.env = { ...ambiente };
});

describe("o caminho feliz", () => {
  it("⭐ grava como TEMPLATE, manda o modelo e confirma o envio", async () => {
    const { db, gravadas, atualizadas } = banco();

    const r = await abordarLead(db, { leadId: "L1", autorUserId: "u1", agora: AGORA });

    expect(r.abordou).toBe(true);
    expect(gravadas[0]!.tipo).toBe("TEMPLATE");
    expect(gravadas[0]!.templateNome).toBe("foocci_abordagem_inicial");
    expect(gravadas[0]!.status).toBe("PENDENTE");
    expect(atualizadas[0]!.status).toBe("ENVIADA");
  });

  it("leva o primeiro nome como {{1}}", async () => {
    const { db } = banco();
    await abordarLead(db, { leadId: "L1", autorUserId: "u1", agora: AGORA });

    const modelo = enviarModelo.mock.calls[0]![2] as { parametros: string[] };
    expect(modelo.parametros).toEqual(["Marina"]);
  });

  it("toda mensagem sai com responsável — nunca 'o sistema mandou'", async () => {
    const { db, gravadas } = banco();
    await abordarLead(db, { leadId: "L1", autorUserId: "u7", agora: AGORA });
    expect(gravadas[0]!.autorUserId).toBe("u7");
  });
});

describe("⛔ a ordem das travas", () => {
  it("o portão do lead vem ANTES do freio", async () => {
    // Com o freio estourado E o lead em opt-out, o motivo tem de ser o opt-out.
    // Ao contrário, a tela diria "espere uma hora" para alguém que nunca mais
    // pode ser abordado.
    const { db } = banco({ lead: { optOutAt: new Date("2026-09-02") }, jaSairam: 9999 });

    const r = await abordarLead(db, { leadId: "L1", autorUserId: "u1", agora: AGORA });

    expect(r.abordou).toBe(false);
    expect(r.abordou === false && r.motivo).toBe("portaoRecusou");
    expect(r.abordou === false && r.detalhe).toContain("LEAD_OPT_OUT");
  });

  it("quem pediu silêncio não recebe, e nada é gravado", async () => {
    const { db, gravadas } = banco({ lead: { optOutAt: new Date("2026-09-02") } });
    await abordarLead(db, { leadId: "L1", autorUserId: "u1", agora: AGORA });

    expect(gravadas).toHaveLength(0);
    expect(enviarModelo).not.toHaveBeenCalled();
  });

  it("⛔ o freio barra antes de gravar qualquer coisa", async () => {
    const { db, gravadas } = banco({ jaSairam: 9999 });

    const r = await abordarLead(db, { leadId: "L1", autorUserId: "u1", agora: AGORA });

    expect(r.abordou === false && r.motivo).toBe("ritmo");
    expect(gravadas).toHaveLength(0);
    expect(enviarModelo).not.toHaveBeenCalled();
  });

  it("lead que não existe não vira envio às cegas", async () => {
    const { db } = banco({ lead: null });
    const r = await abordarLead(db, { leadId: "sumiu", autorUserId: "u1", agora: AGORA });
    expect(r.abordou === false && r.motivo).toBe("leadNaoExiste");
  });

  it("canal desligado é recusa do portão, não tentativa", async () => {
    canalPronto.mockReturnValue(false);
    const { db } = banco();
    const r = await abordarLead(db, { leadId: "L1", autorUserId: "u1", agora: AGORA });
    expect(r.abordou === false && r.motivo).toBe("portaoRecusou");
    expect(enviarModelo).not.toHaveBeenCalled();
  });
});

describe("quando a Meta recusa", () => {
  it("⛔ a linha vira FALHOU com o motivo escrito, nunca sucesso silencioso", async () => {
    enviarModelo.mockResolvedValue({ ok: false, error: "Template name does not exist" });
    const { db, gravadas, atualizadas } = banco();

    const r = await abordarLead(db, { leadId: "L1", autorUserId: "u1", agora: AGORA });

    expect(r.abordou).toBe(false);
    expect(r.abordou === false && r.motivo).toBe("aMetaRecusou");
    // Gravou ANTES de tentar: a linha existe mesmo com a entrega falhando.
    expect(gravadas).toHaveLength(1);
    expect(atualizadas[0]!.status).toBe("FALHOU");
    expect(atualizadas[0]!.erro).toContain("Template name does not exist");
  });
});

describe("o primeiro nome", () => {
  it("pega só o primeiro", () => {
    expect(primeiroNome("Marina Gambarini")).toBe("Marina");
    expect(primeiroNome("  Omar  Freitas ")).toBe("Omar");
  });

  it("⛔ nome que é telefone NÃO vira saudação", () => {
    // Três das cinco fichas da base têm o próprio número no campo nome.
    // "Olá 5511999998888" é pior que não chamar pelo nome.
    expect(primeiroNome("5511999998888")).toBeNull();
    expect(primeiroNome("+55 (11) 99999-8888")).toBeNull();
  });

  it("vazio vira null, e não string vazia", () => {
    expect(primeiroNome("")).toBeNull();
    expect(primeiroNome("   ")).toBeNull();
    expect(primeiroNome(null)).toBeNull();
  });

  it("lead sem nome utilizável manda modelo sem variável", async () => {
    const { db } = banco({ lead: { nome: "5511999998888" } });
    await abordarLead(db, { leadId: "L1", autorUserId: "u1", agora: AGORA });

    const modelo = enviarModelo.mock.calls[0]![2] as { parametros: string[] };
    expect(modelo.parametros).toEqual([]);
  });
});

describe("a configuração do modelo", () => {
  it("idioma tem padrão pt_BR, nome não tem padrão nenhum", () => {
    // Nome com padrão faria a casa mandar um modelo que ninguém escolheu.
    expect(modeloConfigurado({})).toEqual({ nome: "", idioma: "pt_BR" });
  });

  it("o resumo gravado na conversa diz qual modelo saiu", () => {
    // Bolha vazia na tela do vendedor é pior que uma que diz o nome do modelo.
    expect(resumoDoModelo({ nome: "foocci_abordagem_inicial", idioma: "pt_BR", parametros: ["Marina"] }))
      .toBe("[modelo: foocci_abordagem_inicial] (Marina)");
  });
});
