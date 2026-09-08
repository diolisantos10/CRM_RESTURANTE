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

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const signature = req.headers.get("x-stone-signature") ?? "";

  /**
   * ─── ESTA PORTA ESTAVA ABERTA, E FOI MEDIDA ABERTA ───────────────────────
   *
   * Aqui existia `if (!secret) { console.error("CRITICAL"); }` — e SEGUIA EM
   * FRENTE. Em 07/09/2026 conferi a lista de variáveis da produção no Railway:
   * `STONE_WEBHOOK_SECRET` **não existe lá**. Ou seja, este endereço aceitava
   * qualquer requisição da internet, sem assinatura nenhuma, e a partir do
   * CORPO dela marcava o pagamento como PAID, o pedido como CONFIRMED, contava
   * o cupom e registrava a receita no CRM. Diferente do Mercado Pago, ele **não
   * reconsulta o provedor**: confia no que chegou.
   *
   * E era pior do que "porta da Stone aberta", porque a busca do pagamento
   * (abaixo) não filtrava por provedor: um `providerReference` do MERCADO PAGO
   * casava aqui. O webhook do Mercado Pago tem segredo configurado e verifica
   * assinatura — este era o desvio em volta dele. Quem tem um pedido Pix em
   * aberto conhece a própria referência: confirmava o próprio pedido sem pagar.
   *
   * ─── POR QUE FECHAR NÃO QUEBRA NADA, e isso foi medido também ────────────
   * O checkout só produz link da Stone quando `STONE_CLIENT_ID` e
   * `STONE_CLIENT_SECRET` existem (`api/pedido/[slug]/finalize/route.ts:784`).
   * Nenhum dos dois está na produção. Nenhum link da Stone é criado hoje, então
   * nenhum pagamento legítimo depende deste endereço. Guardrail 5 conferido: a
   * proteção não é mais destrutiva que o problema que ela evita.
   *
   * O aviso ficou, e ele carrega a evidência (guardrail 6): quando o segredo
   * faltar, o log diz que faltou — mas quem decide é o `return`, não o log.
   * Prompt é aviso; código é trava.
   */
  const secret = process.env.STONE_WEBHOOK_SECRET;
  if (!secret) {
    console.error(
      "[webhook/stone] RECUSADO: STONE_WEBHOOK_SECRET não está configurado. " +
        "Sem o segredo não há como distinguir a Stone de qualquer chamador — " +
        "o evento foi descartado sem tocar em pedido nenhum.",
      { eventoDescartado: true, bytes: rawBody.length },
    );
    return NextResponse.json({ error: "Webhook not configured" }, { status: 401 });
  }
  if (!verifyWebhookSignature(rawBody, signature)) {
    console.warn("[webhook/stone] Invalid signature — request rejected.", {
      assinaturaRecebida: signature ? "presente" : "ausente",
      bytes: rawBody.length,
    });
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

  // `providerName` no filtro é metade do conserto: sem ele, uma referência do
  // Mercado Pago era aceita por esta porta, contornando o webhook do MP — que é
  // o que tem segredo e verifica assinatura.
  const payment = await prisma.payment.findFirst({
    where: { providerReference, providerName: "stone" },
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
