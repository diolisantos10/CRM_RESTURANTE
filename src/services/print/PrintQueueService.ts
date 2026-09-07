/**
 * PrintQueueService — turns a confirmed order into station-routed print jobs for
 * the Carteiro.
 *
 *   CAIXA / CUPOM  → nota completa (todos os itens, valores, totais, pagamento).
 *   Cozinha / Copa → comanda resumida com APENAS os itens roteados para aquela
 *                    estação (categoria → estação, em MenuCategory.printStationKeys).
 *
 * Routing rules (honor the panel — never spray, never lose a ticket):
 *   - An item prints on every kitchen station its category is mapped to.
 *   - Mapped ONLY to the caixa/cupom → no kitchen comanda (the nota already lists it).
 *   - Unmapped, or mapped only to a kitchen without a printer → the DEFAULT kitchen
 *     (the first kitchen with a printer, by position) — one ticket, never all of them.
 *   - Stations without an assigned printer are skipped.
 *
 * Idempotent: an atomic `printQueuedAt` stamp guarantees one enqueue per order.
 * Fire-and-forget from every CONFIRMED entry point (mirrors the Saipos hook).
 */

import { prisma } from "@/lib/prisma";
import { isGuestIdentifier } from "@/lib/guest";
import { formatOrderNumber } from "@/lib/order-number";
import { buildStoreInfo } from "@/lib/print-ticket";
import { escapeNulForPg } from "@/lib/pg-text";
import {
  renderKitchenTicketText,
  renderCashierTicketText,
  type TicketItem,
  type TicketOrder,
} from "./ticketText";

const CASHIER_STATION_KEYS = new Set(["CAIXA", "CUPOM"]);

export class PrintQueueService {
  /**
   * Enqueue station print jobs for an order, exactly once. Safe to call repeatedly.
   *
   * O carimbo é desfeito quando NADA foi enfileirado. Sem isso, o pedido que
   * chegou antes de a impressora estar configurada — ou durante uma falha de
   * banco — saía carimbado como "já tratado" e não imprimia nunca mais, nem
   * depois de o lojista terminar a configuração. O carimbo existe para impedir
   * papel em dobro; job nenhum criado significa que não há nada para duplicar.
   */
  static async maybeEnqueueOrder(restaurantId: string, orderId: string): Promise<void> {
    // Atomic once-only guard — the first caller wins the race, the rest no-op.
    const stamped = await prisma.order.updateMany({
      where: { id: orderId, restaurantId, printQueuedAt: null },
      data:  { printQueuedAt: new Date() },
    });
    if (stamped.count === 0) return;

    let jobs = 0;
    try {
      jobs = await this.enqueue(restaurantId, orderId);
    } catch (err) {
      console.error("[PrintQueueService] enqueue failed", {
        restaurantId, orderId, err: err instanceof Error ? err.message : String(err),
      });
    }

    if (jobs === 0) {
      await prisma.order
        .updateMany({ where: { id: orderId, restaurantId }, data: { printQueuedAt: null } })
        .catch((err) => console.error("[PrintQueueService] failed to release the print stamp", {
          restaurantId, orderId, err: err instanceof Error ? err.message : String(err),
        }));
      console.warn("[PrintQueueService] nothing enqueued — stamp released so the order can print later", {
        restaurantId, orderId,
      });
    }
  }

  /** Force a re-print of an order's station tickets — bypasses the once-only guard. */
  static async reprintOrder(
    restaurantId: string,
    orderId: string,
  ): Promise<{ ok: boolean; jobs: number; reason?: string }> {
    try {
      const jobs = await this.enqueue(restaurantId, orderId);
      if (jobs === 0) {
        return { ok: false, jobs: 0, reason: "Nenhuma estação com impressora recebeu itens deste pedido." };
      }
      return { ok: true, jobs };
    } catch (err) {
      console.error("[PrintQueueService] reprint failed", {
        restaurantId, orderId, err: err instanceof Error ? err.message : String(err),
      });
      return { ok: false, jobs: 0, reason: "Erro ao reimprimir." };
    }
  }

  private static async enqueue(restaurantId: string, orderId: string): Promise<number> {
    const [order, restaurant, stations, categories, agent] = await Promise.all([
      prisma.order.findUnique({
        where: { id: orderId },
        include: {
          items:           true,
          payment:         true,
          customer:        { select: { name: true, phone: true } },
          deliveryAddress: true,
        },
      }),
      prisma.restaurant.findUnique({
        where:  { id: restaurantId },
        select: {
          name: true, address: true, timezone: true,
          storeProfile: {
            select: {
              cnpj: true, street: true, streetNumber: true, complement: true,
              neighborhood: true, city: true, state: true, cep: true,
            },
          },
        },
      }),
      prisma.printStation.findMany({ where: { restaurantId, enabled: true }, orderBy: { position: "asc" } }),
      prisma.menuCategory.findMany({ where: { restaurantId }, select: { id: true, printStationKeys: true } }),
      prisma.printAgent.findUnique({ where: { restaurantId }, select: { kitchenLargeFont: true } }),
    ]);

    if (!order || !restaurant) return 0;

    // Only stations with a real printer assigned can receive jobs.
    const printable = stations.filter((s) => s.printerName && s.printerName.trim());
    if (printable.length === 0) {
      console.info("[PrintQueueService] no station has a printer — nothing to enqueue", { restaurantId, orderId });
      return 0;
    }

    const tz = restaurant.timezone || "America/Sao_Paulo";
    const phone = order.customer.phone && !isGuestIdentifier(order.customer.phone) ? order.customer.phone : null;

    const ticketOrder: TicketOrder = {
      id:           order.id,
      orderNumber:  order.orderNumber,
      type:         order.type,
      subtotal:     order.subtotal,
      deliveryFee:  order.deliveryFee,
      discount:     order.discount,
      total:        order.total,
      notes:        order.notes,
      createdAt:    order.createdAt,
      estimatedAt:  order.estimatedAt,
      customerName: order.customer.name,
      customerPhone: phone,
      address: order.deliveryAddress
        ? {
            street:       order.deliveryAddress.street,
            number:       order.deliveryAddress.number,
            complement:   order.deliveryAddress.complement,
            neighborhood: order.deliveryAddress.neighborhood,
            city:         order.deliveryAddress.city,
            zipCode:      order.deliveryAddress.zipCode,
          }
        : null,
      payment: order.payment
        ? { method: order.payment.method, amount: order.payment.amount, status: order.payment.status, changeFor: order.payment.changeFor }
        : null,
    };
    const allItems: TicketItem[] = order.items.map((it) => ({
      name: it.name, price: it.price, quantity: it.quantity, notes: it.notes,
      variantName: it.variantName, addonsJson: it.addonsJson,
    }));

    const store = buildStoreInfo(
      { name: restaurant.name, address: restaurant.address, timezone: tz },
      restaurant.storeProfile,
    );

    // category → station keys
    const catToStations = new Map<string, string[]>();
    for (const c of categories) catToStations.set(c.id, c.printStationKeys ?? []);

    // A printer assigned to a cashier station prints ONLY the full nota — never a
    // kitchen comanda. Computed first so kitchen routing can steer clear of it.
    const cashierPrinters = new Set(
      printable.filter((s) => CASHIER_STATION_KEYS.has(s.key)).map((s) => s.printerName!.trim()),
    );

    // Kitchens a comanda can actually land on: not a cashier station, and not sitting
    // on a printer the caixa already owns. The first one (lowest position) is the
    // "estação padrão" — where items whose category has no kitchen fall, ONE ticket
    // each, never a copy on every printer.
    const kitchenKeys = printable
      .filter((s) => !CASHIER_STATION_KEYS.has(s.key) && !cashierPrinters.has(s.printerName!.trim()))
      .map((s) => s.key);
    const defaultKitchen = kitchenKeys[0] ?? null;

    // Which kitchen(s) should this item print on? Honors what the panel configured:
    //   • mapped to real kitchen(s)   → exactly those, and only those
    //   • mapped ONLY to caixa/cupom  → nothing (the caixa nota already lists it)
    //   • unmapped, or mapped only to a printerless kitchen → the estação padrão
    // Never sprays to every kitchen; never silently drops an item on the floor.
    const stationsForItem = (categoryId: string | null): string[] => {
      const mapped = categoryId ? (catToStations.get(categoryId) ?? []) : [];
      const validKitchens = mapped.filter((k) => kitchenKeys.includes(k));
      if (validKitchens.length > 0) return validKitchens;
      const cashierOnly = mapped.length > 0 && mapped.every((k) => CASHIER_STATION_KEYS.has(k));
      if (cashierOnly) return [];
      return defaultKitchen ? [defaultKitchen] : [];
    };

    const title = `Pedido ${formatOrderNumber(order.orderNumber, order.id)}`;
    const jobs: Array<{
      restaurantId: string; orderId: string; stationKey: string;
      printerName: string; title: string; body: string;
    }> = [];

    const cashierDone = new Set<string>();

    for (const station of printable) {
      const printerName = station.printerName!.trim();

      if (CASHIER_STATION_KEYS.has(station.key)) {
        if (cashierDone.has(printerName)) continue; // one nota per physical printer
        cashierDone.add(printerName);
        const body = renderCashierTicketText({
          order: ticketOrder, items: allItems, restaurantName: restaurant.name, store, timezone: tz,
        });
        jobs.push({ restaurantId, orderId, stationKey: station.key, printerName, title: `${title} - ${station.name}`, body });
        continue;
      }

      // Never send a kitchen comanda to a printer that belongs to the caixa —
      // the caixa gets the full nota only.
      if (cashierPrinters.has(printerName)) {
        console.info("[PrintQueueService] skipping kitchen comanda on a cashier printer", {
          restaurantId, orderId, stationKey: station.key, printerName,
        });
        continue;
      }

      const stationItems: TicketItem[] = order.items
        .filter((it) => stationsForItem(it.categoryId).includes(station.key))
        .map((it) => ({ name: it.name, price: it.price, quantity: it.quantity, notes: it.notes, variantName: it.variantName, addonsJson: it.addonsJson }));
      if (stationItems.length === 0) continue;

      const body = renderKitchenTicketText({
        order: ticketOrder, items: stationItems, restaurantName: restaurant.name, stationName: station.name,
        timezone: tz, largeFont: agent?.kitchenLargeFont ?? false,
      });
      jobs.push({ restaurantId, orderId, stationKey: station.key, printerName, title: `${title} - ${station.name}`, body });
    }

    if (jobs.length === 0) {
      console.info("[PrintQueueService] no jobs produced", { restaurantId, orderId });
      return 0;
    }

    // O texto da comanda é ESC/POS: carrega bytes 0x00 como PARÂMETRO de comando
    // (corte de papel, negrito off, tamanho de fonte). O Postgres recusa 0x00 em
    // coluna de texto (22021) — era isto que derrubava TODO enfileiramento, com
    // o pedido já pago e confirmado. Guardamos escapado e desfazemos no único
    // ponto que entrega ao Carteiro (api/print-agent/poll). Ver src/lib/pg-text.ts.
    const escapedJobs = jobs.map((j) => ({
      ...j,
      title: escapeNulForPg(j.title),
      body: escapeNulForPg(j.body),
    }));

    await prisma.printJob.createMany({ data: escapedJobs });
    console.info("[PrintQueueService] enqueued station print jobs", {
      restaurantId, orderId, jobs: jobs.length, stations: jobs.map((j) => j.stationKey),
    });
    return jobs.length;
  }
}
