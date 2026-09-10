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

import { and, desc, eq, gte, inArray, notInArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { customers, locations, orderEvents, orderItemModifiers, orderItems, orders, organizations, payments } from "@/db/schema";
import { assertChannelFulfilment } from "@/domain/order-channel";
import { type FulfilmentType, type OrderStatus, TERMINAL_STATUSES, assertTransition } from "@/domain/order-status";
import { isSupabaseConfigured } from "@/lib/env";
import { type Paise, ZERO, paise } from "@/lib/money";
import { priceOrder } from "@/lib/pricing";
import { fromMicro, toPoint } from "@/lib/delivery";
import { quoteForPin } from "./delivery";
import { resolvePricingContext } from "./org";
import { getPricedCart } from "@/lib/cart";
import { getCustomer } from "@/lib/customer";
import { createPendingPayment } from "./payments";
import { IdempotencyConflict, withIdempotency } from "./idempotency";

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
  email: z.email("Enter a valid email address.").max(160),
  /**
   * Consent to marketing. Separate from placing the order, and false unless
   * the customer actively ticked it.
   *
   * An order is permission to fulfil an order. Under the DPDP Act, using the
   * same details to advertise later is a different purpose and needs its own
   * consent — and §30 rules out dark patterns, which a pre-ticked box is.
   */
  marketingConsent: z.coerce.boolean().default(false),
  notes: z.string().trim().max(500).optional(),

  fulfilment: z.enum(["TAKEAWAY", "DELIVERY"]).default("TAKEAWAY"),
  /** Required for delivery. Ignored for collection. */
  lat: z.coerce.number().min(-90).max(90).optional(),
  lng: z.coerce.number().min(-180).max(180).optional(),
  addressLine1: z.string().trim().max(200).optional(),
  landmark: z.string().trim().max(200).optional(),
  /**
   * Minted when the checkout page renders and sent back with the submission.
   *
   * A double-tap on a slow connection sends the same key twice, and the second
   * one returns the first order instead of creating another. §17.
   */
  idempotencyKey: z.string().uuid(),
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
/**
 * Places an order.
 *
 * Takes `unknown` and validates. This is reached from a Server Action, which
 * is a public HTTP endpoint however it looks in the source — typing the
 * parameter as the already-parsed shape would be asserting something about
 * data that has not been checked yet.
 */
export async function placeOrder(input: unknown): Promise<PlaceOrderResult> {
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

  const details = parsed.data;

  // Delivery needs a pin and something for the rider to look for. Checked here
  // rather than only in the browser: a form can be submitted without ever
  // loading the page that shows these fields.
  if (details.fulfilment === "DELIVERY") {
    const fieldErrors: Record<string, string> = {};
    if (details.lat === undefined || details.lng === undefined) {
      fieldErrors.lat = "Drop a pin so we know where to bring it.";
    }
    if (!details.addressLine1) fieldErrors.addressLine1 = "Tell us the house, flat or shop.";
    if (!details.landmark) fieldErrors.landmark = "Give the rider something to look for.";
    if (Object.keys(fieldErrors).length > 0) {
      return { ok: false, error: "We need a bit more to deliver this.", fieldErrors };
    }
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

  const { id: orgId } = org;
  const { id: locationId } = location;

  // Ordered on the website; collected or delivered. The pair is checked here
  // and again by a constraint on the table.
  const channel = "ONLINE" as const;
  const fulfilment = details.fulfilment;
  assertChannelFulfilment(channel, fulfilment);

  /*
   * The delivery fee is recomputed from the pin, right now, on the server.
   *
   * Nothing trusts the quote the browser was last shown: it may be stale, the
   * rates may have changed since the page loaded, and the figure in the form
   * is attacker-controlled like everything else the client sends.
   */
  let deliveryFee = ZERO;
  let deliveryDistance: number | null = null;
  let pin: { latMicro: number; lngMicro: number } | null = null;

  if (fulfilment === "DELIVERY") {
    pin = toPoint({ lat: details.lat!, lng: details.lng! });
    const quote = await quoteForPin({ to: pin, orderValue: cart.totals.gross });
    if (!quote.available) {
      return { ok: false, error: quote.reason };
    }
    deliveryFee = quote.fee;
    deliveryDistance = quote.chargeableMetres;
  }

  // Totals including the fee, priced by the same function the cart uses.
  const context = await resolvePricingContext();
  const totals = priceOrder(
    {
      lines: cart.lines.map((line) => ({
        unitPrice: line.product.price,
        quantity: line.quantity,
        modifierDeltas: line.modifiers.map((modifier) => modifier.priceDelta),
        rateBps: line.product.taxRateBps,
      })),
      fees:
        deliveryFee > ZERO
          ? [{ label: "Delivery", amount: deliveryFee, rateBps: cart.lines[0]?.product.taxRateBps ?? 500 }]
          : [],
    },
    context,
  );

  try {
    const { result } = await withIdempotency(
      {
        key: details.idempotencyKey,
        operation: "placeOrder",
        orgId: org.id,
        request: { phone: details.phone, total: totals.gross.toString(), lines: cart.lines.length },
      },
      () => writeOrder(),
    );
    return result;
  } catch (error) {
    if (error instanceof IdempotencyConflict) {
      return { ok: false, error: "That looks like a repeat submission. Refresh and try again." };
    }
    throw error;
  }

  async function writeOrder(): Promise<PlaceOrderResult> {
  const orderNumber = await nextOrderNumber(orgId);
  const now = new Date();

  /*
   * The customer record.
   *
   * Keyed on phone, which is the identity that matters here — people change
   * email addresses and spell their names differently, but the number the shop
   * calls stays put.
   *
   * Consent is only ever turned on, never off, by an order: someone who opted
   * in last month and left the box unticked today has not withdrawn consent,
   * they just did not tick a box. Withdrawal is a deliberate act and belongs
   * on its own screen, not as a side effect of ordering dinner.
   */
  // If the customer is signed in, the order belongs to their account rather
  // than to whatever phone number they typed. Guest checkout still works and
  // still creates a record — §61 says not to force an account before a first
  // order.
  const signedIn = await getCustomer();

  const [customer] = signedIn
    ? await database
        .update(customers)
        .set({ name: details.name, email: details.email, updatedAt: now })
        .where(eq(customers.id, signedIn.id))
        .returning()
    : await database
    .insert(customers)
    .values({
      orgId,
      name: details.name,
      phone: details.phone,
      email: details.email,
      marketingConsent: details.marketingConsent,
      marketingConsentAt: details.marketingConsent ? now : null,
    })
    .onConflictDoUpdate({
      target: [customers.orgId, customers.phone],
      set: {
        name: details.name,
        email: details.email,
        updatedAt: now,
        ...(details.marketingConsent ? { marketingConsent: true, marketingConsentAt: now } : {}),
      },
    })
    .returning();

  const [order] = await database
    .insert(orders)
    .values({
      orgId,
      locationId,
      orderNumber,
      customerId: customer?.id,
      status: "PENDING_PAYMENT",
      channel,
      fulfilment,
      customerName: details.name,
      customerPhone: details.phone,
      notes: details.notes,
      deliveryAddress:
        fulfilment === "DELIVERY"
          ? { line1: details.addressLine1 ?? "", landmark: details.landmark ?? "" }
          : null,
      deliveryLatMicro: pin?.latMicro ?? null,
      deliveryLngMicro: pin?.lngMicro ?? null,
      deliveryDistanceMetres: deliveryDistance,
      deliveryFee,
      subtotal: cart.totals.listed,
      discountTotal: cart.totals.discount,
      taxableTotal: totals.taxable,
      cgstTotal: totals.cgst,
      sgstTotal: totals.sgst,
      igstTotal: totals.igst,
      taxTotal: totals.total,
      grandTotal: totals.gross,
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
        orgId,
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
          orgId,
          orderItemId: item.id,
          groupName: "Options",
          modifierName: modifier.name,
          priceDelta: modifier.priceDelta,
        })),
      );
    }
  }

  await database.insert(orderEvents).values({
    orgId,
    orderId: order.id,
    fromStatus: "DRAFT",
    toStatus: "PENDING_PAYMENT",
    reason: `Placed on the website for ${fulfilment === "DELIVERY" ? "delivery" : "collection"}`,
  });

  // What the order is waiting on. Cash at the counter, recorded now so the
  // till has a row to settle against rather than an implicit expectation.
  await createPendingPayment({ orgId, orderId: order.id, amount: totals.gross });

  return { ok: true, orderId: order.id, orderNumber };
  }
}

export interface OrderView {
  readonly id: string;
  readonly orderNumber: string;
  readonly status: string;
  readonly fulfilment: FulfilmentType;
  readonly invoiceNumber: string | null;
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
    fulfilment: order.fulfilment,
    invoiceNumber: order.invoiceNumber,
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

/* ------------------------------------------------------------------ */
/* Staff                                                               */
/* ------------------------------------------------------------------ */

export interface StaffOrderView {
  readonly id: string;
  readonly orderNumber: string;
  readonly status: OrderStatus;
  readonly fulfilment: FulfilmentType;
  readonly customerName: string | null;
  readonly customerPhone: string | null;
  readonly grandTotal: Paise;
  readonly isPaid: boolean;
  readonly invoiceNumber: string | null;
  readonly placedAt: Date | null;
  readonly notes: string | null;
  readonly items: readonly { name: string; quantity: number; modifiers: string[] }[];
  /** Set only on a delivery order. */
  readonly delivery: {
    readonly line1: string;
    readonly landmark: string;
    readonly lat: number;
    readonly lng: number;
    readonly distanceMetres: number | null;
    readonly fee: Paise;
  } | null;
}

/**
 * Orders the counter still has to do something about, newest first.
 *
 * Terminal orders are excluded: a completed or cancelled order is history, and
 * a counter screen that accumulates them becomes unreadable by the second
 * lunch service.
 */
export async function listActiveOrders(orgId: string): Promise<readonly StaffOrderView[]> {
  const database = db();

  const rows = await database
    .select()
    .from(orders)
    .where(and(eq(orders.orgId, orgId), notInArray(orders.status, [...TERMINAL_STATUSES])))
    .orderBy(desc(orders.createdAt))
    .limit(100);

  if (rows.length === 0) return [];

  const ids = rows.map((row) => row.id);
  const items = await database.select().from(orderItems).where(inArray(orderItems.orderId, ids));
  const itemIds = items.map((item) => item.id);
  const mods =
    itemIds.length > 0
      ? await database.select().from(orderItemModifiers).where(inArray(orderItemModifiers.orderItemId, itemIds))
      : [];
  const paid = await database
    .select()
    .from(payments)
    .where(and(inArray(payments.orderId, ids), eq(payments.status, "CAPTURED")));

  const paidOrderIds = new Set(paid.map((payment) => payment.orderId));

  return rows.map((row) => ({
    id: row.id,
    orderNumber: row.orderNumber,
    status: row.status,
    fulfilment: row.fulfilment,
    customerName: row.customerName,
    customerPhone: row.customerPhone,
    grandTotal: paise(row.grandTotal),
    isPaid: paidOrderIds.has(row.id),
    invoiceNumber: row.invoiceNumber,
    placedAt: row.placedAt,
    notes: row.notes,
    delivery:
      row.fulfilment === "DELIVERY" && row.deliveryLatMicro !== null && row.deliveryLngMicro !== null
        ? {
            line1: row.deliveryAddress?.line1 ?? "",
            landmark: row.deliveryAddress?.landmark ?? "",
            lat: fromMicro(row.deliveryLatMicro),
            lng: fromMicro(row.deliveryLngMicro),
            distanceMetres: row.deliveryDistanceMetres,
            fee: paise(row.deliveryFee),
          }
        : null,
    items: items
      .filter((item) => item.orderId === row.id)
      .map((item) => ({
        name: item.productName,
        quantity: item.quantity,
        modifiers: mods.filter((mod) => mod.orderItemId === item.id).map((mod) => mod.modifierName),
      })),
  }));
}

/**
 * Moves an order to the next status.
 *
 * The transition is validated by the domain state machine, not by whatever the
 * button happened to send — a stale screen must not be able to push an order
 * backwards. The actor is recorded on the event.
 */
export async function advanceOrder(input: {
  orderId: string;
  to: OrderStatus;
  actorUserId: string;
  orgId: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const database = db();
  const [order] = await database
    .select()
    .from(orders)
    .where(and(eq(orders.id, input.orderId), eq(orders.orgId, input.orgId)))
    .limit(1);

  if (!order) return { ok: false, error: "That order does not exist." };

  /*
   * An order cannot be completed until it has been paid for.
   *
   * Cooking an unpaid order is normal — cash on collection and cash on
   * delivery both take the money at the end. Handing it over unpaid is giving
   * food away, and COMPLETED is the moment it leaves for good.
   *
   * The check reads the payments rather than the order's own status, because
   * with cash the money can be recorded at any point up to handover.
   */
  if (input.to === "COMPLETED") {
    const captured = await database
      .select({ id: payments.id })
      .from(payments)
      .where(and(eq(payments.orderId, order.id), eq(payments.status, "CAPTURED")))
      .limit(1);

    if (captured.length === 0) {
      return {
        ok: false,
        error:
          order.fulfilment === "DELIVERY"
            ? "Take the cash from the rider before closing this order."
            : "Take payment before handing this over.",
      };
    }
  }

  try {
    assertTransition(order.status, input.to, order.fulfilment);
  } catch {
    return { ok: false, error: `An order that is ${order.status.toLowerCase()} cannot become ${input.to.toLowerCase()}.` };
  }

  const now = new Date();
  await database
    .update(orders)
    .set({
      status: input.to,
      updatedAt: now,
      ...(input.to === "ACCEPTED" ? { acceptedAt: now } : {}),
      ...(input.to === "READY" ? { readyAt: now } : {}),
      ...(input.to === "COMPLETED" ? { completedAt: now } : {}),
    })
    .where(eq(orders.id, order.id));

  await database.insert(orderEvents).values({
    orgId: input.orgId,
    orderId: order.id,
    fromStatus: order.status,
    toStatus: input.to,
    actorUserId: input.actorUserId,
  });

  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* Customer                                                            */
/* ------------------------------------------------------------------ */

export interface CustomerOrderView {
  readonly id: string;
  readonly orderNumber: string;
  readonly status: OrderStatus;
  readonly fulfilment: FulfilmentType;
  readonly grandTotal: Paise;
  readonly pointsEarned: number;
  readonly placedAt: Date | null;
  readonly itemSummary: string;
}

/**
 * One customer's orders, newest first.
 *
 * Scoped by both customer and org. The customer id comes from the session, but
 * scoping by org as well means a stray id from another tenant cannot return
 * anything — the app queries as `postgres` and bypasses row-level security, so
 * this filter is the boundary rather than a second opinion on one.
 */
export async function listCustomerOrders(input: {
  customerId: string;
  orgId: string;
  limit?: number;
}): Promise<readonly CustomerOrderView[]> {
  const database = db();

  const rows = await database
    .select()
    .from(orders)
    .where(and(eq(orders.customerId, input.customerId), eq(orders.orgId, input.orgId)))
    .orderBy(desc(orders.createdAt))
    .limit(input.limit ?? 50);

  if (rows.length === 0) return [];

  const items = await database
    .select()
    .from(orderItems)
    .where(inArray(orderItems.orderId, rows.map((row) => row.id)));

  return rows.map((row) => {
    const mine = items.filter((item) => item.orderId === row.id);
    const names = mine.map((item) => `${item.quantity}× ${item.productName}`);

    return {
      id: row.id,
      orderNumber: row.orderNumber,
      status: row.status,
      fulfilment: row.fulfilment,
      grandTotal: paise(row.grandTotal),
      pointsEarned: row.pointsEarned,
      placedAt: row.placedAt,
      // Two items then a count, so a long order does not wrap a card.
      itemSummary:
        names.length <= 2 ? names.join(", ") : `${names.slice(0, 2).join(", ")} +${names.length - 2} more`,
    };
  });
}
