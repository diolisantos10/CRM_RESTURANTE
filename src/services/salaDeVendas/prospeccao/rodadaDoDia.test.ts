/**
 * A RODADA DO DIA — o laço, e as três reações que ele precisa distinguir.
 *
 * ─── POR QUE ESTE LAÇO EXISTE ───────────────────────────────────────────────
 * Medido em 08/09/2026: `abordarItemDaFila` aborda UM item, a rota só sabia
 * acioná-lo um por chamada, e **não existe cron de prospecção** — nenhuma das
 * 17 pastas de `api/cron` é da Sala. Os "250 por dia" que o CEO pediu eram, na
 * prática, 250 acionamentos manuais.
 *
 * ─── O QUE ESTE ARQUIVO GUARDA, e é a única coisa difícil aqui ─────────────
 * A diferença entre **o portão funcionando** e **o caminho quebrado**.
 *
 *   · opt-out, lote não liberado → o portão fez o trabalho. **Pula e segue.**
 *     Parar aqui deixaria um silêncio no topo da lista bloqueando os outros 249.
 *   · teto/freio → não é defeito e não adianta tentar o próximo. **Encerra.**
 *   · a Meta recusou, o banco não gravou → **PARA**, e grita.
 *
 * A regra de parar na primeira falha é do Diretor Geral, com a razão dita:
 * *"não empurre 250 em cima de um defeito — é assim que se queima uma lista de
 * 4.000 num dia."*
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const selecao = vi.hoisted(() => ({
  montarFilaDeProspeccao: vi.fn(),
  materializarLead: vi.fn(),
}));
vi.mock("./selecao", () => selecao);

const abordar = vi.hoisted(() => ({ abordarLead: vi.fn() }));
vi.mock("../abordar", () => abordar);

const freio = vi.hoisted(() => ({ conferirRitmo: vi.fn() }));
vi.mock("../freioDeRitmo", () => freio);

import { abordarARodadaDoDia } from "./abordarDaFila";

const db = {} as never;

function fila(quantos: number) {
  return {
    liberados: Array.from({ length: quantos }, (_, i) => ({
      itemId: `i${i + 1}`,
      loteId: "lote1",
      leadId: null,
      nome: `Restaurante ${i + 1}`,
      whatsapp: `1199999000${i}`,
      decisao: { sendable: true },
    })),
    barrados: [],
    motivoDaFilaVazia: null,
    usadosHoje: 0,
    tetoDoDia: 250,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  freio.conferirRitmo.mockResolvedValue({ pode: true });
  selecao.materializarLead.mockImplementation(async (_db: unknown, itemId: string) => ({
    materializado: true,
    leadId: `lead_${itemId}`,
  }));
  abordar.abordarLead.mockResolvedValue({ abordou: true, mensagemId: "m1" });
});

describe("o caminho feliz", () => {
  it("⭐ aborda a fila inteira e termina por 'filaAcabou'", async () => {
    selecao.montarFilaDeProspeccao.mockResolvedValue(fila(3));

    const r = await abordarARodadaDoDia(db, { autorUserId: "u1", canalPronto: true });

    expect(r.abordados).toBe(3);
    expect(r.pulados).toBe(0);
    expect(r.parouPor).toBe("filaAcabou");
    expect(r.falha).toBeNull();
    expect(r.extrato.map((e) => e.itemId)).toEqual(["i1", "i2", "i3"]);
  });

  it("⭐ o FREIO é relido a cada item — a objeção do comentário da rota", async () => {
    // A rota argumentava contra aceitar lista: "faria o freio valer para o lote
    // inteiro a partir de uma leitura só". A objeção está certa, e a rodada não
    // a viola — é isto que este caso tranca.
    selecao.montarFilaDeProspeccao.mockResolvedValue(fila(4));

    await abordarARodadaDoDia(db, { autorUserId: "u1", canalPronto: true });

    expect(freio.conferirRitmo, "o freio foi lido uma vez para o lote inteiro").toHaveBeenCalledTimes(4);
  });
});

describe("⭐ o portão funcionando NÃO para a rodada", () => {
  it("quem pediu silêncio é pulado, e os outros são abordados", async () => {
    selecao.montarFilaDeProspeccao.mockResolvedValue(fila(3));
    abordar.abordarLead
      .mockResolvedValueOnce({ abordou: false, motivo: "portaoRecusou", detalhe: "pediu silêncio" })
      .mockResolvedValue({ abordou: true, mensagemId: "m" });

    const r = await abordarARodadaDoDia(db, { autorUserId: "u1", canalPronto: true });

    expect(r.abordados, "um opt-out no topo travou a lista inteira").toBe(2);
    expect(r.pulados).toBe(1);
    expect(r.parouPor).toBe("filaAcabou");
    expect(r.extrato[0]).toEqual({ itemId: "i1", ok: false, motivo: "portaoRecusou" });
  });

  it("item que não virou lead é pulado, não é falha", async () => {
    selecao.montarFilaDeProspeccao.mockResolvedValue(fila(2));
    selecao.materializarLead.mockResolvedValueOnce({ materializado: false, motivo: "Item em situação DUPLICADO." });

    const r = await abordarARodadaDoDia(db, { autorUserId: "u1", canalPronto: true });

    expect(r.pulados).toBe(1);
    expect(r.abordados).toBe(1);
    expect(r.parouPor).toBe("filaAcabou");
  });
});

describe("⛔ o caminho quebrado PARA na primeira falha", () => {
  it("⭐ a Meta recusou: para, e os seguintes NÃO são tentados", async () => {
    const erro = vi.spyOn(console, "error").mockImplementation(() => {});
    selecao.montarFilaDeProspeccao.mockResolvedValue(fila(5));
    abordar.abordarLead
      .mockResolvedValueOnce({ abordou: true, mensagemId: "m1" })
      .mockResolvedValueOnce({ abordou: false, motivo: "aMetaRecusou", detalhe: "template not found" })
      .mockResolvedValue({ abordou: true, mensagemId: "mX" });

    const r = await abordarARodadaDoDia(db, { autorUserId: "u1", canalPronto: true });

    expect(r.parouPor).toBe("falha");
    expect(r.abordados).toBe(1);
    expect(r.falha).toEqual({ itemId: "i2", motivo: "aMetaRecusou", detalhe: "template not found" });

    // A prova que importa: os três restantes nunca foram tentados.
    expect(abordar.abordarLead, "empurrou a lista em cima do defeito").toHaveBeenCalledTimes(2);

    // Guardrail 6: o alerta carrega o item e o motivo.
    const grito = erro.mock.calls.find((c) => String(c[0]).includes("rodada INTERROMPIDA"));
    expect(grito, "parou calada").toBeTruthy();
    expect((grito![1] as Record<string, unknown>).itemId).toBe("i2");
    erro.mockRestore();
  });

  it("banco que não grava também para a rodada", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    selecao.montarFilaDeProspeccao.mockResolvedValue(fila(3));
    abordar.abordarLead.mockResolvedValue({ abordou: false, motivo: "naoConseguiuGravar", detalhe: "db" });

    const r = await abordarARodadaDoDia(db, { autorUserId: "u1", canalPronto: true });

    expect(r.parouPor).toBe("falha");
    expect(abordar.abordarLead).toHaveBeenCalledTimes(1);
  });
});

describe("o freio encerra sem ser falha", () => {
  it("⭐ teto do dia atingido: encerra como fim normal, e não como defeito", async () => {
    selecao.montarFilaDeProspeccao.mockResolvedValue(fila(4));
    freio.conferirRitmo
      .mockResolvedValueOnce({ pode: true })
      .mockResolvedValue({ pode: false, detalhe: "teto do dia" });

    const r = await abordarARodadaDoDia(db, { autorUserId: "u1", canalPronto: true });

    expect(r.parouPor, "o teto do dia foi tratado como defeito").toBe("freio");
    expect(r.falha).toBeNull();
    expect(r.abordados).toBe(1);
  });
});

describe("o teto da rodada", () => {
  it("⭐ manda no máximo o que foi pedido, mesmo com fila maior", async () => {
    selecao.montarFilaDeProspeccao.mockResolvedValue(fila(10));

    const r = await abordarARodadaDoDia(db, { autorUserId: "u1", canalPronto: true, teto: 3 });

    expect(r.abordados).toBe(3);
    expect(r.parouPor).toBe("tetoDaRodada");
    expect(abordar.abordarLead).toHaveBeenCalledTimes(3);
  });

  it("o teto também é passado para a fila, e não só conferido depois", async () => {
    selecao.montarFilaDeProspeccao.mockResolvedValue(fila(2));
    await abordarARodadaDoDia(db, { autorUserId: "u1", canalPronto: true, teto: 10 });
    expect(selecao.montarFilaDeProspeccao.mock.calls[0][1]).toMatchObject({ limite: 10 });
  });
});

describe("fila vazia", () => {
  it("não é falha, não grita, e diz que a fila acabou", async () => {
    const erro = vi.spyOn(console, "error").mockImplementation(() => {});
    selecao.montarFilaDeProspeccao.mockResolvedValue(fila(0));

    const r = await abordarARodadaDoDia(db, { autorUserId: "u1", canalPronto: true });

    expect(r).toMatchObject({ abordados: 0, pulados: 0, parouPor: "filaAcabou", falha: null });
    expect(erro).not.toHaveBeenCalled();
    erro.mockRestore();
  });
});
