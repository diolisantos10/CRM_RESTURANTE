/**
 * WhatsAppOrderCreationService — controlled order creation from a WhatsApp session.
 *
 * Delegates to CheckoutFinalizationService.createOrderRecord() — the same inner
 * transaction used by the /pedido finalize route. No parallel order-creation logic.
 *
 * Modes:
 *   DRY_RUN_ONLY / ALLOWLIST_REPLY_ONLY → never creates. Returns wouldCreate summary.
 *   ALLOWLIST_FULL_TEST                 → creates a real order via the shared service.
 *
 * Pix orders are created as AWAITING_PAYMENT (hidden from the operational dashboard
 * until the MP webhook approves). Pay-on-delivery orders follow finalize's flow.
 * Idempotency: if the session already has an orderId, no new order is created.
 */

import type { WaPersistedSession } from "./types";
import { adaptSessionToOrderInput } from "./WhatsAppCheckoutAdapter";
import { createOrderRecord } from "@/services/checkout/CheckoutFinalizationService";

export interface OrderCreationInput {
  session:      WaPersistedSession;
  customerName: string;
  subtotal:     number;
  deliveryFee:  number;
  total:        number;
  allowCreate:  boolean; // true only in ALLOWLIST_FULL_TEST with guards passed
}

export interface OrderCreationResult {
  orderId:     string | null;
  status:      string | null;
  wouldCreate: boolean;
  isPix:       boolean;
  created:     boolean;
  reason:      string;
  /** Customer-facing reply when guards block order creation. */
  blockedReply?: string;
}

export async function createOrderFromSession(
  input: OrderCreationInput,
): Promise<OrderCreationResult> {
  const { session, customerName, subtotal, deliveryFee, total, allowCreate } = input;
  const isPix = session.paymentMethod === "PIX";

  // Idempotency: never re-create if session already has an order
  if (session.orderId) {
    return {
      orderId:     session.orderId,
      status:      isPix ? "AWAITING_PAYMENT" : "CONFIRMED",
      wouldCreate: false,
      isPix,
      created:     false,
      reason:      "session already has an orderId (idempotent)",
    };
  }

  if (!allowCreate) {
    return {
      orderId:     null,
      status:      isPix ? "AWAITING_PAYMENT" : "PENDING",
      wouldCreate: true,
      isPix,
      created:     false,
      reason:      "dry-run / not full-test mode — no order created",
    };
  }

  // Adapt session → CheckoutFinalizationService input
  // runGuards=true: business hours + ordering pause are checked here
  const adapted = await adaptSessionToOrderInput(
    session, customerName, subtotal, deliveryFee, total, /* runGuards= */ true,
  );

  if (!adapted.ok) {
    return {
      orderId:     null,
      status:      null,
      wouldCreate: false,
      isPix,
      created:     false,
      reason:      adapted.reason ?? "adapter validation failed",
      blockedReply: adapted.replyText,
    };
  }

  // Create the order via the shared engine
  const created = await createOrderRecord(adapted.input!);

  // For offline payments: create payment record + confirm the order immediately
  // (mirrors the finalize route non-Pix path)
  if (!isPix) {
    const { prisma }          = await import("@/lib/prisma");
    const { Decimal }         = await import("@prisma/client/runtime/library");
    const dbMethod: "CASH" | "CARD_MACHINE" =
      session.paymentMethod === "CARD" ? "CARD_MACHINE" : "CASH";
    const isDelivery = session.deliveryType === "DELIVERY";
    await prisma.$transaction([
      prisma.payment.create({
        data: {
          orderId:     created.orderId,
          method:      dbMethod,
          status:      isDelivery ? "PAY_ON_DELIVERY" : "PAY_ON_PICKUP",
          amount:      new Decimal(total),
          paymentMode: isDelivery ? "PAY_ON_DELIVERY" : "PAY_ON_PICKUP",
        },
      }),
      prisma.order.update({
        where: { id: created.orderId },
        data:  { status: "CONFIRMED" },
      }),
    ]);

    // A quinta porta, e ela não estava na lista do raio-x — apareceu ao
    // recensear todo ponto que escreve CONFIRMED em `order`. O pedido por texto
    // no WhatsApp confirmava na hora (dinheiro/maquininha) e nunca imprimia.
    const { enfileirarComandaDoPagamento } = await import("@/services/print/comandaDoPagamento");
    enfileirarComandaDoPagamento({
      restaurantId:   session.restaurantId,
      orderId:        created.orderId,
      statusDoPedido: "CONFIRMED",
      origem:         "whatsapp pedido por texto",
    });
  }

  // Close any OPEN /pedido draft for this customer so abandonment recovery never fires
  // after a WhatsApp order. Pix orders are covered too — Rule 8 already blocks recovery
  // for AWAITING_PAYMENT, but closing the draft is cleaner and handles edge cases.
  {
    const { prisma } = await import("@/lib/prisma");
    void prisma.orderDraft.updateMany({
      where: {
        restaurantId: session.restaurantId,
        customerId:   created.customerId,
        status:       "OPEN",
      },
      data: { status: "CONFIRMED", confirmedAt: new Date() },
    }).catch((err) =>
      console.warn("[WhatsAppOrderCreationService] draft close failed", {
        orderId:  created.orderId,
        error:    err instanceof Error ? err.message : String(err),
      }),
    );
  }

  return {
    orderId:     created.orderId,
    status:      isPix ? "AWAITING_PAYMENT" : "CONFIRMED",
    wouldCreate: true,
    isPix,
    created:     true,
    reason:      isPix
      ? "order created AWAITING_PAYMENT (Pix pending webhook)"
      : "order created CONFIRMED (pay on delivery/pickup)",
  };
}
