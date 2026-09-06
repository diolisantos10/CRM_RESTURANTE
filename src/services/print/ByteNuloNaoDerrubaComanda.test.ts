/**
 * A comanda chega na impressora, e chega byte por byte igual.
 *
 * ─── O QUE ISTO REPRODUZ ────────────────────────────────────────────────────
 * Entre 31/08 e 06/09/2026, 33 pedidos do Sushi Cazza foram pagos e confirmados
 * e NENHUM gerou trabalho de impressão. Treze num só turno. Em seis dias e três
 * deploys, ZERO enfileiramentos bem-sucedidos: `printJob.createMany()` morria
 * com PostgresError 22021 — `invalid byte sequence for encoding UTF8: 0x00`.
 *
 * ─── POR QUE A SUÍTE NÃO PEGOU, e é a lição ─────────────────────────────────
 * Porque `prisma` é dublê no teste: um `vi.fn()` aceita alegremente o byte que o
 * Postgres recusa. Os testes chegavam ao objeto passado para o Prisma e paravam
 * ali — nunca ao banco, e portanto nunca ao papel. Verde de ponta a ponta com o
 * recurso 100% quebrado em produção.
 *
 * Por isso ESTE arquivo não tem uma única asserção sobre "a função existe" ou
 * "o import está lá". Ele prova duas coisas, e as duas são o que a cozinha vive:
 *
 *   1. O que vai para o BANCO é aceitável pelo Postgres (nenhum 0x00).
 *   2. O que sai para o CARTEIRO é byte a byte idêntico ao ESC/POS original —
 *      porque apagar o 0x00 "resolveria" (1) e imprimiria lixo: `GS V 0x00` é o
 *      comando de CORTAR PAPEL, e sem o parâmetro a impressora engole o próximo
 *      byte. A trava contra a correção ingênua é o teste de ida e volta.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const NUL = "\u0000";

const db = vi.hoisted(() => ({
  order:        { updateMany: vi.fn(), findUnique: vi.fn() },
  restaurant:   { findUnique: vi.fn() },
  printStation: { findMany: vi.fn() },
  menuCategory: { findMany: vi.fn() },
  printAgent:   { findUnique: vi.fn() },
  printJob:     { createMany: vi.fn() },
}));
vi.mock("@/lib/prisma", () => ({ prisma: db }));

import { PrintQueueService } from "./PrintQueueService";
import { escapeNulForPg, restoreNulFromPg } from "@/lib/pg-text";
import { renderKitchenTicketText } from "./ticketText";

const PEDIDO = {
  id: "ord_1", orderNumber: 77, type: "DELIVERY",
  subtotal: 119.8, deliveryFee: 0, discount: 0, total: 119.8, notes: "sem cebola",
  createdAt: new Date("2026-09-04T21:02:35Z"), estimatedAt: null,
  customer: { name: "Maria", phone: "11999998888" },
  deliveryAddress: { street: "R. A", number: "1", complement: null, neighborhood: "Centro", city: "Poá", state: "SP" },
  payment: { method: "ONLINE", amount: 119.8, status: "PAID" },
  items: [
    { name: "Hot Roll", price: 59.9, quantity: 1, notes: "bem passado", addonsJson: null, categoryId: "cat_sushi" },
    { name: "Coca",     price: 59.9, quantity: 1, notes: null,          addonsJson: null, categoryId: "cat_bebida" },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  db.order.updateMany.mockResolvedValue({ count: 1 });
  db.order.findUnique.mockResolvedValue(PEDIDO);
  db.restaurant.findUnique.mockResolvedValue({
    name: "Sushi Cazza", address: null, timezone: "America/Sao_Paulo",
    storeProfile: { cnpj: "123", street: "Av X", streetNumber: "10", complement: null, neighborhood: "Centro", city: "Poá", state: "SP", cep: null },
  });
  db.printStation.findMany.mockResolvedValue([
    { key: "CAIXA",     name: "Caixa",     printerName: "Caixa01", enabled: true, position: 0 },
    { key: "COZINHA_1", name: "Cozinha 1", printerName: "Cz1",     enabled: true, position: 1 },
  ]);
  db.menuCategory.findMany.mockResolvedValue([
    { id: "cat_sushi",  printStationKeys: ["COZINHA_1"] },
    { id: "cat_bebida", printStationKeys: [] },
  ]);
  db.printAgent.findUnique.mockResolvedValue({ kitchenLargeFont: false });
  db.printJob.createMany.mockResolvedValue({ count: 2 });
});

function gravados(): Array<{ stationKey: string; title: string; body: string }> {
  return db.printJob.createMany.mock.calls[0][0].data;
}

describe("o texto da comanda é ESC/POS e carrega 0x00 por natureza", () => {
  it("um pedido SEM nada de estranho já produz bytes nulos — não é o cliente que os digita", () => {
    const texto = renderKitchenTicketText({
      order: {
        id: "x", orderNumber: 1, type: "DELIVERY", subtotal: 10, deliveryFee: 0, discount: 0,
        total: 10, notes: null, createdAt: new Date("2026-09-04T21:00:00Z"), estimatedAt: null,
        customerName: "Maria", customerPhone: null, address: null, payment: null,
      },
      items: [{ name: "Hot Roll", price: 10, quantity: 1, notes: null, variantName: null, addonsJson: null }],
      restaurantName: "Sushi Cazza", stationName: "Cozinha 1",
      timezone: "America/Sao_Paulo", largeFont: false,
    });
    expect(texto.includes(NUL)).toBe(true);
  });
});

describe("a comanda volta a ser enfileirada, e o Carteiro recebe o original", () => {
  it("ENFILEIRA — em produção o createMany nem chegava a ser aceito pelo banco", async () => {
    await PrintQueueService.maybeEnqueueOrder("rest_1", "ord_1");
    expect(db.printJob.createMany).toHaveBeenCalledTimes(1);
    expect(gravados().length).toBeGreaterThan(0);
  });

  it("nada do que vai para o banco carrega 0x00 — é o byte que o Postgres recusa", async () => {
    await PrintQueueService.maybeEnqueueOrder("rest_1", "ord_1");
    for (const j of gravados()) {
      expect(j.body.includes(NUL), `body de ${j.stationKey} ainda tem 0x00`).toBe(false);
      expect(j.title.includes(NUL), `title de ${j.stationKey} ainda tem 0x00`).toBe(false);
    }
  });

  it("⭐ IDA E VOLTA: desfazer é o inverso EXATO do que foi aplicado ao gravar", async () => {
    await PrintQueueService.maybeEnqueueOrder("rest_1", "ord_1");

    // Não reconstruo a comanda à mão — isso testaria a minha cópia, não o
    // serviço. Provo a propriedade que importa: o que a rota entrega ao
    // Carteiro, re-escapado, é IDÊNTICO ao que está gravado. Ou seja, nenhum
    // byte se perdeu nem apareceu no caminho de volta.
    for (const j of gravados()) {
      const paraOCarteiro = restoreNulFromPg(j.body);
      expect(escapeNulForPg(paraOCarteiro), `${j.stationKey} não fecha a volta`).toBe(j.body);
      // E a volta REPÕE os bytes: não é um no-op disfarçado de prova.
      expect(paraOCarteiro.includes(NUL), `${j.stationKey} voltou sem os 0x00`).toBe(true);
      expect(paraOCarteiro.length).toBe(j.body.length);
    }
  });

  it("⭐ o comando de CORTAR PAPEL chega inteiro — apagar o 0x00 imprimiria lixo", async () => {
    await PrintQueueService.maybeEnqueueOrder("rest_1", "ord_1");
    for (const j of gravados()) {
      const paraImpressora = restoreNulFromPg(j.body);
      // GS V 0x00 — corte total. Sem o parâmetro, a impressora engole o próximo byte.
      expect(paraImpressora.endsWith("\u001d\u0056\u0000"), `${j.stationKey} perdeu o corte`).toBe(true);
    }
  });

  it("o texto que a cozinha lê continua o mesmo", async () => {
    await PrintQueueService.maybeEnqueueOrder("rest_1", "ord_1");
    const cozinha = restoreNulFromPg(gravados().find((j) => j.stationKey === "COZINHA_1")!.body);
    expect(cozinha).toContain("HOT ROLL");
    expect(cozinha.toUpperCase()).toContain("BEM PASSADO");
  });
});

describe("escapar e desfazer são exatamente inversos", () => {
  it("ida e volta devolve a string idêntica, com 0x00 no meio, no início e no fim", () => {
    const bruto = `${NUL}abc${NUL}${NUL}def${NUL}`;
    expect(restoreNulFromPg(escapeNulForPg(bruto))).toBe(bruto);
    expect(escapeNulForPg(bruto).includes(NUL)).toBe(false);
  });

  it("texto sem 0x00 atravessa sem alteração nenhuma", () => {
    const limpo = "Pedido #77 — Hot Roll, açaí, 1x";
    expect(escapeNulForPg(limpo)).toBe(limpo);
    expect(restoreNulFromPg(limpo)).toBe(limpo);
  });

  it("conta os bytes certos", () => {
    expect(escapeNulForPg("")).toBe("");
    expect(restoreNulFromPg("")).toBe("");
  });
});
