/**
 * O webhook da Stone recusa quem não prova ser a Stone.
 *
 * ─── O QUE ESTAVA ABERTO, medido na produção em 07/09/2026 ──────────────────
 * A rota trazia `if (!secret) { console.error("CRITICAL"); }` e **seguia em
 * frente**. Conferi a lista de variáveis do serviço FOOCCI no Railway:
 * `STONE_WEBHOOK_SECRET` **não está lá** — nem estava. Ou seja, o endereço
 * aceitava qualquer requisição da internet, sem assinatura, e a partir do CORPO
 * dela marcava `payment: PAID`, `order: CONFIRMED`, contava o cupom da promoção
 * e registrava a receita no CRM. E não reconsulta a Stone: confia no que chegou.
 *
 * ─── E O DESVIO ERA MAIOR QUE A PORTA ───────────────────────────────────────
 * A busca do pagamento não filtrava por provedor. Uma referência do MERCADO
 * PAGO casava aqui. O webhook do Mercado Pago tem segredo configurado e
 * verifica assinatura — este era o caminho em volta dele. Quem tem um pedido
 * Pix em aberto conhece a própria referência, e confirmava o próprio pedido sem
 * pagar. É dinheiro saindo pela porta, não risco teórico.
 *
 * ─── AS DUAS METADES ────────────────────────────────────────────────────────
 * Cada caso aqui tem a metade que prova a trava e a metade que reproduz o
 * ataque de antes. Teste que só prova o caminho feliz não teria pegado nada
 * disto — a rota já respondia 200 para todo mundo, e era esse o defeito.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import crypto from "node:crypto";

const SEGREDO = "segredo-de-teste-da-stone";

const db = vi.hoisted(() => {
  const d = {
    payment: { findFirst: vi.fn(), update: vi.fn(async () => ({})) },
    order:   { findUnique: vi.fn(async () => null), update: vi.fn(async () => ({})), updateMany: vi.fn(async () => ({ count: 0 })) },
    promotion: { update: vi.fn(async () => ({})) },
    $transaction: vi.fn(async (ops: unknown) =>
      Array.isArray(ops) ? Promise.all(ops) : (ops as (tx: unknown) => unknown)(d),
    ),
  };
  return d;
});
vi.mock("@/lib/prisma", () => ({ prisma: db }));
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

import { POST } from "./route";

const CORPO = JSON.stringify({ event_type: "payment.approved", id: "ref_da_stone" });

function assinar(corpo: string, segredo: string) {
  return crypto.createHmac("sha256", segredo).update(corpo, "utf8").digest("hex");
}

function bater(corpo = CORPO, assinatura?: string) {
  return POST(
    new NextRequest("https://foocci.com.br/api/payments/stone/webhook", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(assinatura ? { "x-stone-signature": assinatura } : {}),
      },
      body: corpo,
    }),
  );
}

/** Nada de pedido nem de pagamento foi tocado. É esta a prova, não o status. */
function nadaFoiEscrito() {
  expect(db.payment.update, "marcou pagamento como pago").not.toHaveBeenCalled();
  expect(db.order.update, "mexeu no pedido").not.toHaveBeenCalled();
  expect(db.$transaction, "abriu a transação que confirma o pedido").not.toHaveBeenCalled();
}

const segredoOriginal = process.env.STONE_WEBHOOK_SECRET;

beforeEach(() => {
  vi.clearAllMocks();
  process.env.STONE_WEBHOOK_SECRET = SEGREDO;
  db.payment.findFirst.mockResolvedValue({
    id: "pay_1", orderId: "ord_1", status: "LINK_SENT",
    order: { id: "ord_1", status: "AWAITING_PAYMENT", restaurantId: "rest_1" },
  });
  db.order.findUnique.mockResolvedValue({ promotionId: null, couponUsageCountedAt: null });
});

afterEach(() => {
  if (segredoOriginal === undefined) delete process.env.STONE_WEBHOOK_SECRET;
  else process.env.STONE_WEBHOOK_SECRET = segredoOriginal;
});

describe("sem o segredo, a porta fica fechada — e era assim que a produção estava", () => {
  it("⭐ sem STONE_WEBHOOK_SECRET: 401, e NENHUM pedido é confirmado", async () => {
    delete process.env.STONE_WEBHOOK_SECRET;

    const res = await bater();

    expect(res.status, "aceitou chamada sem segredo configurado").toBe(401);
    nadaFoiEscrito();
  });

  it("⭐ sem segredo, nem uma assinatura bem-formada entra", async () => {
    delete process.env.STONE_WEBHOOK_SECRET;

    const res = await bater(CORPO, assinar(CORPO, "qualquer-coisa"));

    expect(res.status).toBe(401);
    nadaFoiEscrito();
  });

  it("nem chega a consultar o banco — recusa antes de tocar em dado de cliente", async () => {
    delete process.env.STONE_WEBHOOK_SECRET;
    await bater();
    expect(db.payment.findFirst).not.toHaveBeenCalled();
  });
});

describe("com o segredo, só a Stone entra", () => {
  it("⭐ assinatura errada: 401 e nada escrito", async () => {
    const res = await bater(CORPO, assinar(CORPO, "outro-segredo"));
    expect(res.status).toBe(401);
    nadaFoiEscrito();
  });

  it("sem cabeçalho de assinatura: 401", async () => {
    const res = await bater(CORPO, undefined);
    expect(res.status).toBe(401);
    nadaFoiEscrito();
  });

  it("corpo adulterado depois de assinado: 401", async () => {
    const assinatura = assinar(CORPO, SEGREDO);
    const adulterado = JSON.stringify({ event_type: "payment.approved", id: "ref_de_outro" });
    const res = await bater(adulterado, assinatura);
    expect(res.status).toBe(401);
    nadaFoiEscrito();
  });

  it("⭐ A METADE LEGÍTIMA: assinatura correta confirma o pedido", async () => {
    // Sem esta, a trava poderia ser "recusa tudo" e passar como conserto.
    const res = await bater(CORPO, assinar(CORPO, SEGREDO));

    expect(res.status).toBe(200);
    expect(db.$transaction, "a Stone de verdade não conseguiu confirmar").toHaveBeenCalledTimes(1);
    expect(db.payment.update).toHaveBeenCalled();
    expect(db.order.update).toHaveBeenCalled();
  });

  it("aceita também o cabeçalho no formato sha256=<hex>", async () => {
    const res = await bater(CORPO, `sha256=${assinar(CORPO, SEGREDO)}`);
    expect(res.status).toBe(200);
  });
});

describe("⭐ a referência do Mercado Pago não entra pela porta da Stone", () => {
  it("a busca do pagamento exige providerName 'stone'", async () => {
    await bater(CORPO, assinar(CORPO, SEGREDO));

    expect(db.payment.findFirst).toHaveBeenCalledTimes(1);
    const where = (db.payment.findFirst.mock.calls[0][0] as { where: Record<string, unknown> }).where;
    expect(
      where.providerName,
      "sem o filtro de provedor, uma referência do Mercado Pago confirma o pedido por aqui — " +
        "contornando o webhook do MP, que é o que tem segredo",
    ).toBe("stone");
  });

  it("referência que não é da Stone não casa: responde 200 e não confirma nada", async () => {
    // O banco de verdade não devolveria linha para um `where` com providerName
    // 'stone'; o dublê reproduz isso devolvendo null.
    db.payment.findFirst.mockResolvedValue(null);

    const res = await bater(CORPO, assinar(CORPO, SEGREDO));

    expect(res.status).toBe(200); // 200 de propósito: a Stone para de reenviar
    nadaFoiEscrito();
  });
});
