/**
 * O último elo, medido.
 *
 * A cena que dá nome ao arquivo é a primeira: **o freio é consultado ANTES de
 * materializar**. Materializar primeiro e descobrir o teto depois deixaria um
 * lead criado que ninguém abordou — ficha órfã nascida de uma tentativa que não
 * aconteceu, multiplicada pelo tamanho da lista.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const materializar = vi.hoisted(() => vi.fn());
const abordar = vi.hoisted(() => vi.fn());
const ritmo = vi.hoisted(() => vi.fn());

vi.mock("./selecao", () => ({ materializarLead: materializar }));
vi.mock("../abordar", () => ({ abordarLead: abordar }));
vi.mock("../freioDeRitmo", () => ({ conferirRitmo: ritmo }));

const { abordarItemDaFila } = await import("./abordarDaFila");

const db = {} as never;

beforeEach(() => {
  materializar.mockReset();
  abordar.mockReset();
  ritmo.mockReset();
  ritmo.mockResolvedValue({ pode: true, naUltimaHora: 0, nasUltimas24h: 0 });
  materializar.mockResolvedValue({ materializado: true, leadId: "L1" });
  abordar.mockResolvedValue({ abordou: true, mensagemId: "m1" });
});

describe("o caminho feliz", () => {
  it("⭐ vira lead e manda a mensagem, nesta ordem", async () => {
    const r = await abordarItemDaFila(db, { itemId: "i1", autorUserId: "u1" });

    expect(r.abordou).toBe(true);
    expect(r.abordou === true && r.leadId).toBe("L1");
    expect(materializar).toHaveBeenCalledWith(db, "i1");
    expect(abordar.mock.calls[0]![1]).toMatchObject({ leadId: "L1", autorUserId: "u1" });
  });
});

describe("⛔ o freio vem antes de materializar", () => {
  it("com o teto estourado, NENHUM lead é criado", async () => {
    // Esta é a cena. Sem ela, uma lista de 500 contra um teto de 10 criaria
    // 500 leads e abordaria 10.
    ritmo.mockResolvedValue({
      pode: false,
      motivo: "tetoDoDia",
      detalhe: "teto de 200 abordagens em 24h já alcançado (200)",
      naUltimaHora: 0,
      nasUltimas24h: 200,
    });

    const r = await abordarItemDaFila(db, { itemId: "i1", autorUserId: "u1" });

    expect(r.abordou).toBe(false);
    expect(r.abordou === false && r.motivo).toBe("ritmo");
    expect(materializar).not.toHaveBeenCalled();
    expect(abordar).not.toHaveBeenCalled();
  });

  it("a recusa leva o número, não só a palavra 'teto'", async () => {
    ritmo.mockResolvedValue({
      pode: false,
      motivo: "tetoDaHora",
      detalhe: "teto de 30 abordagens por hora já alcançado (30)",
      naUltimaHora: 30,
      nasUltimas24h: 30,
    });
    const r = await abordarItemDaFila(db, { itemId: "i1", autorUserId: "u1" });
    expect(r.abordou === false && r.detalhe).toContain("30");
  });
});

describe("quando o item não vira lead", () => {
  it("devolve o motivo do próprio serviço, sem traduzir", async () => {
    materializar.mockResolvedValue({
      materializado: false,
      motivo: "O lote deste contato não está liberado.",
    });

    const r = await abordarItemDaFila(db, { itemId: "i1", autorUserId: "u1" });

    expect(r.abordou === false && r.motivo).toBe("naoVirouLead");
    expect(r.abordou === false && r.detalhe).toBe("O lote deste contato não está liberado.");
    expect(abordar).not.toHaveBeenCalled();
  });
});

describe("quando a abordagem falha depois de virar lead", () => {
  it("o motivo de abordarLead sobe inteiro", async () => {
    // Traduzir aqui faria a tela mostrar uma explicação que o serviço não deu.
    abordar.mockResolvedValue({
      abordou: false,
      motivo: "aMetaRecusou",
      detalhe: "Template name does not exist",
    });

    const r = await abordarItemDaFila(db, { itemId: "i1", autorUserId: "u1" });

    expect(r.abordou === false && r.motivo).toBe("aMetaRecusou");
    expect(r.abordou === false && r.detalhe).toBe("Template name does not exist");
  });

  it("sonda de controle: o lead JÁ foi criado nesse caso", async () => {
    // O contrário do teste do freio. Aqui materializar tinha de acontecer —
    // se não acontecesse, os dois testes estariam medindo a mesma coisa.
    abordar.mockResolvedValue({ abordou: false, motivo: "aMetaRecusou", detalhe: "x" });
    await abordarItemDaFila(db, { itemId: "i1", autorUserId: "u1" });
    expect(materializar).toHaveBeenCalledOnce();
  });
});
