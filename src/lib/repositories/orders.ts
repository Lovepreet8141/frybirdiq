import "server-only";

/**
 * Placing and reading orders.
 *
 * Everything here is computed on the server. The client sends who it is and
 * what it wants collected; it never sends a price, a total, a tax figure or a
 * status. §13 and §46.
 *
 * UNTESTED AGAINST A LIVE DATABASE. There is no Supabase project yet, so the
 * write path has never executed. It is written against the schema and the
 * seed, and it is the first thing to verify once keys exist.
 */

import { and, eq, gte } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { locations, orderEvents, orderItemModifiers, orderItems, orders, organizations } from "@/db/schema";
import { assertChannelFulfilment } from "@/domain/order-channel";
import { isSupabaseConfigured } from "@/lib/env";
import { getPricedCart } from "@/lib/cart";

const ORG_SLUG = "frybird";

/**
 * What the customer tells us.
 *
 * Phone is the identity that matters in India, and the only way the counter
 * can call about a collection. Indian mobile numbers are ten digits starting
 * 6–9; the pattern is deliberately narrow so a typo is caught here rather
 * than discovered when nobody answers.
 */
export const checkoutSchema = z.object({
  name: z.string().trim().min(1, "Tell us who the order is for.").max(80),
  phone: z
    .string()
    .trim()
    .regex(/^[6-9]\d{9}$/, "Enter a 10-digit mobile number."),
  notes: z.string().trim().max(500).optional(),
});

export type CheckoutInput = z.infer<typeof checkoutSchema>;

export type PlaceOrderResult =
  | { ok: true; orderId: string; orderNumber: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string> };

/**
 * Builds today's order number.
 *
 * Short enough for the counter to call out and the kitchen to write on a
 * ticket — §21. Resets each day, so it never grows into something nobody can
 * read aloud across a noisy kitchen.
 */
async function nextOrderNumber(orgId: string): Promise<string> {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const todays = await db()
    .select({ id: orders.id })
    .from(orders)
    .where(and(eq(orders.orgId, orgId), gte(orders.createdAt, startOfDay)));

  return String(todays.length + 1).padStart(3, "0");
}

/**
 * Places a collection order, to be paid at the counter.
 *
 * Online payment is Phase 2. Rather than fake a payment step, Phase 1 supports
 * the flow a QSR actually runs: order ahead, pay when you collect. The order
 * goes straight to PAID only when money is taken at the counter, so it is
 * created PENDING_PAYMENT and the counter moves it.
 */
export async function placeOrder(input: CheckoutInput): Promise<PlaceOrderResult> {
  if (!isSupabaseConfigured()) {
    return {
      ok: false,
      error:
        "Ordering isn't connected yet, so this order has not been placed. Nothing has been charged. Please call the shop to order.",
    };
  }

  const parsed = checkoutSchema.safeParse(input);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0];
      if (typeof key === "string" && !fieldErrors[key]) fieldErrors[key] = issue.message;
    }
    return { ok: false, error: "Check the details below.", fieldErrors };
  }

  // Priced here, on the server, from the cart cookie's contents only.
  const cart = await getPricedCart();
  if (cart.lines.length === 0) {
    return { ok: false, error: "Your order is empty." };
  }

  const database = db();

  const [org] = await database.select().from(organizations).where(eq(organizations.slug, ORG_SLUG)).limit(1);
  if (!org) return { ok: false, error: "The shop is not set up yet. Nothing has been ordered." };

  const [location] = await database.select().from(locations).where(eq(locations.orgId, org.id)).limit(1);
  if (!location) return { ok: false, error: "The shop is not set up yet. Nothing has been ordered." };

  // An online order collected from the counter. The pair is checked here and
  // again by a constraint on the table.
  const channel = "ONLINE" as const;
  const fulfilment = "TAKEAWAY" as const;
  assertChannelFulfilment(channel, fulfilment);

  const orderNumber = await nextOrderNumber(org.id);
  const now = new Date();

  const [order] = await database
    .insert(orders)
    .values({
      orgId: org.id,
      locationId: location.id,
      orderNumber,
      status: "PENDING_PAYMENT",
      channel,
      fulfilment,
      customerName: parsed.data.name,
      customerPhone: parsed.data.phone,
      notes: parsed.data.notes,
      subtotal: cart.totals.listed,
      discountTotal: cart.totals.discount,
      taxableTotal: cart.totals.taxable,
      cgstTotal: cart.totals.cgst,
      sgstTotal: cart.totals.sgst,
      igstTotal: cart.totals.igst,
      taxTotal: cart.totals.total,
      grandTotal: cart.totals.gross,
      placedAt: now,
    })
    .returning();

  if (!order) return { ok: false, error: "The order could not be saved. Nothing has been charged." };

  for (const [index, line] of cart.lines.entries()) {
    // Name, price and tax rate are copied onto the line. Repricing the menu
    // tomorrow must not rewrite this order. §51.
    const [item] = await database
      .insert(orderItems)
      .values({
        orgId: org.id,
        orderId: order.id,
        productId: null,
        productName: line.product.name,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        lineSubtotal: line.priced.listed,
        lineDiscount: line.priced.discount,
        taxRateBps: line.product.taxRateBps,
        hsnCode: line.product.hsnCode,
        lineTaxable: line.priced.taxable,
        lineTax: line.priced.total,
        lineTotal: line.priced.gross,
        position: index,
      })
      .returning();

    if (item && line.modifiers.length > 0) {
      await database.insert(orderItemModifiers).values(
        line.modifiers.map((modifier) => ({
          orgId: org.id,
          orderItemId: item.id,
          groupName: "Options",
          modifierName: modifier.name,
          priceDelta: modifier.priceDelta,
        })),
      );
    }
  }

  await database.insert(orderEvents).values({
    orgId: org.id,
    orderId: order.id,
    fromStatus: "DRAFT",
    toStatus: "PENDING_PAYMENT",
    reason: "Placed on the website for collection",
  });

  return { ok: true, orderId: order.id, orderNumber };
}

export interface OrderView {
  readonly id: string;
  readonly orderNumber: string;
  readonly status: string;
  readonly customerName: string | null;
  readonly grandTotal: bigint;
  readonly placedAt: Date | null;
  readonly items: readonly { name: string; quantity: number; total: bigint; modifiers: string[] }[];
}

export async function getOrder(id: string): Promise<OrderView | null> {
  if (!isSupabaseConfigured()) return null;

  const database = db();
  const [order] = await database.select().from(orders).where(eq(orders.id, id)).limit(1);
  if (!order) return null;

  const items = await database.select().from(orderItems).where(eq(orderItems.orderId, id));
  const itemIds = items.map((item) => item.id);

  const allModifiers =
    itemIds.length > 0
      ? await database.select().from(orderItemModifiers).where(eq(orderItemModifiers.orgId, order.orgId))
      : [];

  return {
    id: order.id,
    orderNumber: order.orderNumber,
    status: order.status,
    customerName: order.customerName,
    grandTotal: order.grandTotal,
    placedAt: order.placedAt,
    items: items.map((item) => ({
      name: item.productName,
      quantity: item.quantity,
      total: item.lineTotal,
      modifiers: allModifiers
        .filter((modifier) => modifier.orderItemId === item.id)
        .map((modifier) => modifier.modifierName),
    })),
  };
}
