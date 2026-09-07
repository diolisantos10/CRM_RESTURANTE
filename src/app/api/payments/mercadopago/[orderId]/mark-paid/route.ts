/**
 * PATCH /api/payments/mercadopago/[orderId]/mark-paid
 *
 * Manual fallback — mark a Mercado Pago payment as paid.
 * Useful for sandbox / when webhooks don't arrive.
 * Requires OWNER or MANAGER role.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getTenantContext } from "@/lib/tenant";
import { CustomerMetricsSyncService } from "@/services/crm/CustomerMetricsSyncService";
import { CustomerCouponService } from "@/services/crm/CustomerCouponService";
import { enfileirarComandaDoPagamento } from "@/services/print/comandaDoPagamento";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ orderId: string }> }
) {
  const ctx = getTenantContext(req);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (ctx.role !== "OWNER" && ctx.role !== "MANAGER") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { orderId } = await params;

  const order = await prisma.order.findFirst({
    where: { id: orderId, restaurantId: ctx.restaurantId },
    select: { id: true, status: true, promotionId: true, couponUsageCountedAt: true },
  });
  if (!order) return NextResponse.json({ error: "Pedido não encontrado" }, { status: 404 });

  const payment = await prisma.payment.findUnique({
    where: { orderId },
    select: { id: true, providerName: true },
  });
  if (!payment || payment.providerName !== "mercadopago") {
    return NextResponse.json({ error: "Pagamento MP não encontrado" }, { status: 404 });
  }

  await prisma.$transaction([
    prisma.payment.update({
      where: { orderId },
      data: { status: "PAID", paidAt: new Date() },
    }),
    prisma.order.update({
      where: { id: orderId },
      data: { status: "CONFIRMED" },
    }),
  ]);

  // Mesma falha da saída manual do Stone: confirma o pedido e não manda imprimir.
  enfileirarComandaDoPagamento({
    restaurantId:   ctx.restaurantId,
    orderId,
    statusDoPedido: order.status,
    origem:         "mp mark-paid",
  });

  // Idempotent coupon usage count
  if (order.promotionId && !order.couponUsageCountedAt) {
    const stamped = await prisma.order.updateMany({
      where: { id: orderId, couponUsageCountedAt: null },
      data:  { couponUsageCountedAt: new Date() },
    });
    if (stamped.count > 0) {
      await prisma.promotion.update({
        where: { id: order.promotionId },
        data:  { usedCount: { increment: 1 } },
      });
    }
  }

  // Wallet coupon (iFood-style) — consume on payment approval. Idempotent.
  await CustomerCouponService.consumeForPaidOrder(orderId).catch((e) =>
    console.error("[mp mark-paid] wallet coupon consume failed:", e),
  );

  await CustomerMetricsSyncService.syncOrderToCustomerMetrics(orderId, "mp_mark_paid");

  return NextResponse.json({ success: true });
}
