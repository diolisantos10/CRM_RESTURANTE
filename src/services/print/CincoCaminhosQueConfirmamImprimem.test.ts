/**
 * Todo caminho que confirma o pagamento manda o papel para a cozinha.
 *
 * ─── O DEFEITO ──────────────────────────────────────────────────────────────
 * Raio-x de 06/09/2026: cinco caminhos colocavam o pedido em CONFIRMED e nenhum
 * chamava `PrintQueueService.maybeEnqueueOrder`. O pedido era cobrado, entrava
 * no CRM, ia para o Saipos — e a cozinha nunca ficava sabendo.
 *
 * ─── COMO ESTE ARQUIVO MEDE, e por que ele NÃO espiona um dublê ─────────────
 * O `PrintQueueService` **não é dublê aqui**. Ele roda de verdade. A asserção
 * final não é "o serviço foi chamado" — é o TEXTO DA COMANDA que chegou ao
 * `printJob.createMany`, com o nome do prato dentro. É o mais perto do papel que
 * um teste sem impressora chega.
 *
 * A diferença importa, e ela nasceu de uma mutação que sobreviveu no #189:
 * asserir sobre a função prova a função; asserir sobre o CHAMADOR prova o
 * caminho. Aqui o chamador é a rota HTTP, e é ela que está sob teste.
 *
 * ─── O QUE ESTE ARQUIVO NÃO PROVA, dito por extenso ─────────────────────────
 * `prisma` continua sendo dublê: isto prova o que o banco RECEBE, não o que ele
 * aceita. A prova de que o Postgres aceita esses bytes está no #189
 * (`ByteNuloNaoDerrubaComanda.test.ts` + medição contra o banco de produção), e
 * a prova de que o papel sai da impressora nenhum teste desta casa dá — ela é
 * ocular, na loja.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { restoreNulFromPg } from "@/lib/pg-text";
import { pedidoAindaPrecisaDeComanda } from "./comandaDoPagamento";

/** O pedido como o `PrintQueueService` o lê (com `include`). */
const PEDIDO_COMPLETO = {
  id: "ord_1", orderNumber: 77, type: "DELIVERY",
  subtotal: 119.8, deliveryFee: 0, discount: 0, total: 119.8, notes: null,
  createdAt: new Date("2026-09-07T21:02:35Z"), estimatedAt: null,
  customer: { name: "Maria", phone: "11999998888" },
  deliveryAddress: null,
  payment: { method: "ONLINE", amount: 119.8, status: "PAID", changeFor: null },
  items: [
    { name: "Hot Roll", price: 119.8, quantity: 1, notes: null, variantName: null, addonsJson: null, categoryId: "cat_sushi" },
  ],
};

/** O pedido como as ROTAS o leem (com `select`) — outra forma, mesmo pedido. */
const PEDIDO_DA_ROTA = {
  id: "ord_1",
  restaurantId: "rest_1",
  status: "AWAITING_PAYMENT",
  promotionId: null,
  couponUsageCountedAt: null,
  notes: null,
  total: 119.8,
  payment: { id: "pay_1", status: "LINK_SENT", providerName: "mercadopago" },
};

const db = vi.hoisted(() => {
  const d = {
    payment: {
      findFirst:  vi.fn(),
      findUnique: vi.fn(),
      update:     vi.fn(async () => ({})),
      create:     vi.fn(async () => ({})),
    },
    order: {
      // O `include` só aparece na leitura do PrintQueueService; as rotas usam
      // `select`. É por aí que o dublê sabe qual forma devolver.
      findUnique: vi.fn(),
      findFirst:  vi.fn(),
      update:     vi.fn(async () => ({})),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    promotion:    { update: vi.fn(async () => ({})) },
    restaurant:   { findUnique: vi.fn() },
    printStation: { findMany: vi.fn() },
    menuCategory: { findMany: vi.fn() },
    printAgent:   { findUnique: vi.fn() },
    printJob:     { createMany: vi.fn(async () => ({ count: 1 })) },
    $transaction: vi.fn(),
  };
  d.$transaction.mockImplementation(async (ops: unknown) =>
    Array.isArray(ops) ? Promise.all(ops) : (ops as (tx: unknown) => unknown)(d),
  );
  return d;
});
vi.mock("@/lib/prisma", () => ({ prisma: db }));

const tenant = vi.hoisted(() => ({ getTenantContext: vi.fn() }));
vi.mock("@/lib/tenant", () => tenant);

vi.mock("@/lib/stone", () => ({ verifyWebhookSignature: vi.fn(() => true) }));
vi.mock("@/lib/audit", () => ({ auditLog: vi.fn() }));
vi.mock("@/services/crm/CustomerMetricsSyncService", () => ({
  CustomerMetricsSyncService: { syncOrderToCustomerMetrics: vi.fn(async () => null) },
}));
vi.mock("@/services/crm/CustomerCouponService", () => ({
  CustomerCouponService: { consumeForPaidOrder: vi.fn(async () => null) },
}));
vi.mock("@/services/integrations/SaiposIntegrationService", () => ({
  SaiposIntegrationService: { maybeSendOrder: vi.fn(async () => null) },
}));

import { POST as stoneWebhook }   from "@/app/api/payments/stone/webhook/route";
import { PATCH as stoneMarkPaid } from "@/app/api/payments/stone/[orderId]/mark-paid/route";
import { PATCH as mpMarkPaid }    from "@/app/api/payments/mercadopago/[orderId]/mark-paid/route";
import { POST as confirmManual }  from "@/app/api/orders/[id]/confirm-manual-payment/route";

beforeEach(() => {
  vi.clearAllMocks();

  tenant.getTenantContext.mockReturnValue({ restaurantId: "rest_1", role: "OWNER", userId: "u1" });

  db.payment.findFirst.mockResolvedValue({
    id: "pay_1", orderId: "ord_1", status: "LINK_SENT",
    order: { id: "ord_1", status: "AWAITING_PAYMENT", restaurantId: "rest_1" },
  });
  db.payment.findUnique.mockResolvedValue({ id: "pay_1", providerName: "mercadopago" });

  db.order.findUnique.mockImplementation(async (args: { include?: unknown }) =>
    args?.include ? PEDIDO_COMPLETO : PEDIDO_DA_ROTA,
  );
  db.order.findFirst.mockImplementation(async () => PEDIDO_DA_ROTA);
  db.order.updateMany.mockResolvedValue({ count: 1 });

  db.restaurant.findUnique.mockResolvedValue({
    name: "Sushi Cazza", address: null, timezone: "America/Sao_Paulo",
    storeProfile: null,
  });
  db.printStation.findMany.mockResolvedValue([
    { key: "COZINHA_1", name: "Cozinha 1", printerName: "Cz1", enabled: true, position: 0 },
  ]);
  db.menuCategory.findMany.mockResolvedValue([{ id: "cat_sushi", printStationKeys: ["COZINHA_1"] }]);
  db.printAgent.findUnique.mockResolvedValue({ kitchenLargeFont: false });
  db.printJob.createMany.mockResolvedValue({ count: 1 });
});

/**
 * O enfileiramento é "dispara e segue" — a rota responde antes de a fila
 * terminar, de propósito (o cliente não espera a impressora). Esperar aqui é
 * esperar o que a produção também espera.
 */
type LinhaDaFila = { restaurantId: string; orderId: string; body: string };

async function comandaGravada(): Promise<{ texto: string; linhas: LinhaDaFila[] }> {
  await vi.waitFor(() => expect(db.printJob.createMany).toHaveBeenCalledTimes(1), { timeout: 2_000 });
  const linhas = db.printJob.createMany.mock.calls[0][0].data as LinhaDaFila[];
  return { linhas, texto: restoreNulFromPg(linhas.map((j) => j.body).join("\n")) };
}

/**
 * ⭐ ESTA FUNÇÃO NASCEU DE UMA MUTAÇÃO QUE SOBREVIVEU.
 *
 * Troquei `payment.order.restaurantId` por um id de outro dono na rota da Stone
 * e os 72 testes continuaram verdes. Eles provavam que ALGUMA comanda era
 * gravada; não provavam de QUEM ela era.
 *
 * E o estrago em produção seria mudo, do pior tipo: `maybeEnqueueOrder` carimba
 * o pedido com `updateMany({ where: { id, restaurantId, printQueuedAt: null } })`.
 * Com o restaurante errado o WHERE não casa com linha nenhuma, `count` é 0, a
 * função retorna sem erro — e a cozinha não recebe nada. É exatamente o defeito
 * que este PR conserta, voltando por dentro do conserto.
 *
 * As linhas gravadas carregam `restaurantId` e `orderId`; é neles que se olha.
 */
function conferirDono(linhas: LinhaDaFila[]) {
  expect(linhas.length).toBeGreaterThan(0);
  for (const linha of linhas) {
    expect(linha.restaurantId, "a comanda foi para a fila do restaurante errado").toBe("rest_1");
    expect(linha.orderId, "a comanda foi para a fila com o pedido errado").toBe("ord_1");
  }
}

function reqJson(url: string, body: unknown, headers: Record<string, string> = {}) {
  return new NextRequest(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

describe("os cinco caminhos que confirmam o pagamento mandam imprimir", () => {
  it("⭐ 1. webhook da Stone — quem paga com Stone passa a ter comanda", async () => {
    const res = await stoneWebhook(
      reqJson("https://foocci.com.br/api/payments/stone/webhook", {
        event_type: "payment.approved", id: "ref_1",
      }, { "x-stone-signature": "assinada" }),
    );
    expect(res.status).toBe(200);
    const fila = await comandaGravada();
    expect(fila.texto).toContain("HOT ROLL");
    conferirDono(fila.linhas);
  });

  it("⭐ 2. mark-paid da Stone — a saída manual também imprime", async () => {
    const res = await stoneMarkPaid(
      reqJson("https://foocci.com.br/api/payments/stone/ord_1/mark-paid", {}),
      { params: { orderId: "ord_1" } },
    );
    expect(res.status).toBe(200);
    const fila = await comandaGravada();
    expect(fila.texto).toContain("HOT ROLL");
    conferirDono(fila.linhas);
  });

  it("⭐ 3. mark-paid do Mercado Pago — idem", async () => {
    const res = await mpMarkPaid(
      reqJson("https://foocci.com.br/api/payments/mercadopago/ord_1/mark-paid", {}),
      { params: Promise.resolve({ orderId: "ord_1" }) },
    );
    expect(res.status).toBe(200);
    const fila = await comandaGravada();
    expect(fila.texto).toContain("HOT ROLL");
    conferirDono(fila.linhas);
  });

  it("⭐ 4. confirm-manual-payment — a alavanca que o lojista puxa quando nada mais funcionou", async () => {
    const res = await confirmManual(
      reqJson("https://foocci.com.br/api/orders/ord_1/confirm-manual-payment", {
        reason: "cliente pagou no Pix e o webhook não chegou",
      }),
      { params: { id: "ord_1" } },
    );
    expect(res.status).toBe(200);
    const fila = await comandaGravada();
    expect(fila.texto).toContain("HOT ROLL");
    conferirDono(fila.linhas);
  });

  it("⭐ 5. pedido por texto no WhatsApp — a quinta porta, fora da lista do raio-x", async () => {
    // Aqui a prova é o CHAMADOR, não a rota: `createOrderFromSession` monta o
    // pedido por caminhos que este arquivo não tem como montar de fora sem virar
    // um teste do adaptador. O que se prova é que a confirmação por
    // dinheiro/maquininha passa pelo enfileirador — e o texto do arquivo é o
    // artefato honesto disso.
    const fonte = await import("node:fs/promises").then((fs) =>
      fs.readFile("src/services/whatsapp/ordering/WhatsAppOrderCreationService.ts", "utf8"),
    );
    expect(
      fonte.includes("enfileirarComandaDoPagamento"),
      "o pedido por texto voltou a confirmar sem mandar imprimir",
    ).toBe(true);
    // E a chamada está DENTRO do ramo que confirma (o não-Pix), não solta no fim.
    const ramo = fonte.slice(fonte.indexOf("if (!isPix) {"), fonte.indexOf("// Close any OPEN"));
    expect(ramo).toContain("enfileirarComandaDoPagamento");
  });
});

describe("o pedido morto não vira papel", () => {
  it("⭐ pagamento reconciliado em pedido CANCELADO não manda comanda para a cozinha", async () => {
    db.order.findFirst.mockResolvedValue({ ...PEDIDO_DA_ROTA, status: "CANCELLED" });
    db.order.findUnique.mockImplementation(async (args: { include?: unknown }) =>
      args?.include ? PEDIDO_COMPLETO : { ...PEDIDO_DA_ROTA, status: "CANCELLED" },
    );

    const res = await mpMarkPaid(
      reqJson("https://foocci.com.br/api/payments/mercadopago/ord_1/mark-paid", {}),
      { params: Promise.resolve({ orderId: "ord_1" }) },
    );
    expect(res.status).toBe(200);

    // Espera ativa: se fosse enfileirar, enfileiraria neste intervalo.
    await new Promise((r) => setTimeout(r, 50));
    expect(
      db.printJob.createMany,
      "mandou a cozinha fazer um pedido cancelado",
    ).not.toHaveBeenCalled();
  });

  it("pedido já ENTREGUE não reimprime quando o pagamento é reconciliado depois", async () => {
    db.order.findFirst.mockResolvedValue({ ...PEDIDO_DA_ROTA, status: "DELIVERED" });

    await mpMarkPaid(
      reqJson("https://foocci.com.br/api/payments/mercadopago/ord_1/mark-paid", {}),
      { params: Promise.resolve({ orderId: "ord_1" }) },
    );
    await new Promise((r) => setTimeout(r, 50));
    expect(db.printJob.createMany).not.toHaveBeenCalled();
  });
});

describe("a regra, status por status — os oito que o banco conhece", () => {
  // A lista é a do enum OrderStatus em prisma/schema.prisma. Se o enum ganhar um
  // status novo, este teste NÃO reprova sozinho — e essa é a fraqueza dele, dita
  // aqui para não virar promessa. O que ele impede é a mudança silenciosa da
  // regra nos oito que existem hoje.
  const espera: Record<string, boolean> = {
    PENDING:          true,
    AWAITING_PAYMENT: true,
    CONFIRMED:        true,
    PREPARING:        true,
    READY:            false,
    OUT_FOR_DELIVERY: false,
    DELIVERED:        false,
    CANCELLED:        false,
  };

  for (const [status, deveImprimir] of Object.entries(espera)) {
    it(`${status} → ${deveImprimir ? "manda comanda" : "não manda comanda"}`, () => {
      expect(pedidoAindaPrecisaDeComanda(status)).toBe(deveImprimir);
    });
  }

  it("status desconhecido não vira papel — silêncio não é autorização (guardrail 1)", () => {
    expect(pedidoAindaPrecisaDeComanda("QUALQUER_COISA")).toBe(false);
    expect(pedidoAindaPrecisaDeComanda("")).toBe(false);
  });
});
