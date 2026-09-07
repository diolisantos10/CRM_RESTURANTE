/**
 * POST /api/payments/stone/webhook
 *
 * Public endpoint — receives payment status notifications from Stone.
 * Verifies HMAC-SHA256 signature via x-stone-signature header.
 * Idempotent: ignores events for payments already in PAID status.
 *
 * On payment.approved:
 *   Payment: LINK_SENT → PAID (with paidAt)
 *   Order:   AWAITING_PAYMENT → CONFIRMED
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyWebhookSignature } from "@/lib/stone";
import { auditLog } from "@/lib/audit";
import { CustomerMetricsSyncService } from "@/services/crm/CustomerMetricsSyncService";
import { CustomerCouponService } from "@/services/crm/CustomerCouponService";
import { SaiposIntegrationService } from "@/services/integrations/SaiposIntegrationService";
import { enfileirarComandaDoPagamento } from "@/services/print/comandaDoPagamento";

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const signature = req.headers.get("x-stone-signature") ?? "";

  // Enforce signature verification when secret is configured.
  // In dev (no secret), skip — but warn loudly so it's never silently skipped in prod.
  const secret = process.env.STONE_WEBHOOK_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      console.error(
        "[webhook/stone] CRITICAL: STONE_WEBHOOK_SECRET is not set in production. " +
          "All webhook events are being accepted without signature verification."
      );
    } else {
      console.warn("[webhook/stone] Signature verification skipped (STONE_WEBHOOK_SECRET not set).");
    }
  } else if (!verifyWebhookSignature(rawBody, signature)) {
    console.warn("[webhook/stone] Invalid signature — request rejected.");
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const eventType = payload.event_type as string | undefined;

  // Only handle payment approval events
  if (eventType !== "payment.approved" && eventType !== "payment_link.completed") {
    return NextResponse.json({ ok: true });
  }

  // Stone sends the internal payment_link id and order metadata
  const providerReference =
    (payload.id as string | undefined) ??
    ((payload.payment_link as Record<string, unknown> | undefined)?.id as
      | string
      | undefined);

  if (!providerReference) {
    return NextResponse.json({ error: "Missing providerReference" }, { status: 400 });
  }

  const payment = await prisma.payment.findFirst({
    where: { providerReference },
    include: { order: { select: { id: true, status: true, restaurantId: true } } },
  });

  if (!payment) {
    // Unknown reference — Stone might retry; return 200 to stop retries
    return NextResponse.json({ ok: true });
  }

  // Idempotency: if already PAID, do nothing
  if (payment.status === "PAID") {
    return NextResponse.json({ ok: true });
  }

  // Atomic update: payment PAID + order CONFIRMED
  await prisma.$transaction([
    prisma.payment.update({
      where: { id: payment.id },
      data: { status: "PAID", paidAt: new Date() },
    }),
    prisma.order.update({
      where: { id: payment.orderId },
      data: { status: "CONFIRMED" },
    }),
  ]);

  auditLog({
    action: "payment.status_change",
    restaurantId: payment.order.restaurantId,
    targetId: payment.orderId,
    meta: {
      paymentId: payment.id,
      providerReference,
      eventType: eventType ?? "unknown",
      newStatus: "PAID",
    },
  });

  // A COZINHA ANTES DO RESTO. Este caminho nunca enfileirou comanda: quem pagava
  // com Stone tinha o pedido confirmado, a receita no CRM, o Saipos avisado — e
  // nenhum papel na cozinha. Vem antes do cupom e do CRM de propósito: se algo
  // ali embaixo falhar, a comida já está sendo feita.
  enfileirarComandaDoPagamento({
    restaurantId:   payment.order.restaurantId,
    orderId:        payment.orderId,
    statusDoPedido: payment.order.status,
    origem:         "stone webhook",
  });

  // Idempotent coupon usage count: increment Promotion.usedCount only once per order,
  // regardless of how many times the webhook fires. The updateMany WHERE couponUsageCountedAt IS NULL
  // ensures only the first caller wins the race; subsequent calls are no-ops.
  const orderForCoupon = await prisma.order.findUnique({
    where:  { id: payment.orderId },
    select: { promotionId: true, couponUsageCountedAt: true },
  });
  if (orderForCoupon?.promotionId && !orderForCoupon.couponUsageCountedAt) {
    const stamped = await prisma.order.updateMany({
      where: { id: payment.orderId, couponUsageCountedAt: null },
      data:  { couponUsageCountedAt: new Date() },
    });
    if (stamped.count > 0) {
      await prisma.promotion.update({
        where: { id: orderForCoupon.promotionId },
        data:  { usedCount: { increment: 1 } },
      });
    }
  }

  // Wallet coupon (iFood-style) — consume on payment approval. Idempotent.
  await CustomerCouponService.consumeForPaidOrder(payment.orderId).catch((e) =>
    console.error("[stone webhook] wallet coupon consume failed:", e),
  );

  // Sync CRM metrics through the centralized service.
  // crmSyncedAt guards against double-counting on repeated webhooks.
  await CustomerMetricsSyncService.syncOrderToCustomerMetrics(payment.orderId, "stone_webhook");

  // Fire-and-forget: forward confirmed order to Saipos if integration is active.
  SaiposIntegrationService.maybeSendOrder(payment.order.restaurantId, payment.orderId).catch((e) =>
    console.error("[saipos] stone-webhook send failed:", e)
  );

  return NextResponse.json({ ok: true });
}
