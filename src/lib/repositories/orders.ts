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

import { and, desc, eq, inArray, max, notInArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { addresses, customers, locations, loyaltyAccounts, loyaltyTransactions, orderEvents, orderItemModifiers, orderItems, orders, organizations, payments } from "@/db/schema";
import { assertChannelFulfilment, type OrderChannel } from "@/domain/order-channel";
import { type FulfilmentType, type OrderStatus, TERMINAL_STATUSES, assertTransition } from "@/domain/order-status";
import type { Role } from "@/domain/permissions";
import { REJECTION_LABELS, type RejectionReason } from "@/domain/rejection";
import { businessDate } from "@/lib/dates";
import { isSupabaseConfigured } from "@/lib/env";
import { type Paise, ZERO, paise, subtract } from "@/lib/money";
import { priceOrder } from "@/lib/pricing";
import { fromMicro, toPoint } from "@/lib/delivery";
import { quoteForPin } from "./delivery";
import { countPromotionUse } from "./promotions";
import { resolvePricingContext } from "./org";
import { getPricedCart } from "@/lib/cart";
import { getCustomer } from "@/lib/customer";
import { createPendingPayment, recordCashPayment } from "./payments";
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
/**
 * The next order number for today, as the counter would call it out.
 *
 * Three things went wrong in the version this replaces, and each of them broke
 * checkout outright rather than producing an odd number:
 *
 * The day boundary came from `new Date().setHours(0,0,0,0)`, which is midnight
 * in the *server's* timezone. The server runs UTC, so the day rolled over at
 * 05:30 IST — the count reset while the shop was shut and then collided with
 * the morning's real orders.
 *
 * The count was `rows + 1`, so a cancelled or deleted order made the next one
 * reuse a number that was still in the table.
 *
 * And the number resets daily while the unique constraint spanned all time, so
 * the first order of any second day was guaranteed to fail. That is fixed by
 * the constraint now including the business date; this function only has to be
 * right about the date and the maximum.
 *
 * Still not safe against two checkouts landing in the same millisecond — the
 * caller retries on the unique violation, which is the cheap correct answer at
 * one outlet's volume. A sequence per day would be the answer at ten.
 */
async function nextOrderNumber(orgId: string, businessDay: string): Promise<string> {
  const [row] = await db()
    .select({ highest: max(orders.orderNumber) })
    .from(orders)
    .where(and(eq(orders.orgId, orgId), eq(orders.businessDate, businessDay)));

  const next = row?.highest ? Number(row.highest) + 1 : 1;
  return String(next).padStart(3, "0");
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

  /*
   * Totals including the fee, priced by the same function the cart uses.
   *
   * Each line carries `line.priced.discount` forward rather than being
   * repriced from scratch — that figure is already the cart's own promotion
   * allocation plus any stamp-card reward, and recomputing the lines here
   * without it would tax the order as if neither discount existed while
   * `grandTotal` below still reflected them, two figures on the same order
   * that stop agreeing the moment either discount is in play.
   */
  const context = await resolvePricingContext();
  const totals = priceOrder(
    {
      lines: cart.lines.map((line) => ({
        unitPrice: line.product.price,
        quantity: line.quantity,
        modifierDeltas: line.modifiers.map((modifier) => modifier.priceDelta),
        rateBps: line.product.taxRateBps,
        discount: line.priced.discount,
      })),
      fees:
        deliveryFee > ZERO
          ? [{ label: "Delivery", amount: deliveryFee, rateBps: cart.lines[0]?.product.taxRateBps ?? 500 }]
          : [],
    },
    context,
  );

  // What the customer is actually charged: the fee-inclusive, fully
  // discounted total, less any points spent.
  const payable = subtract(totals.gross, cart.points?.discount ?? ZERO);

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
  const businessDay = businessDate(new Date());
  let orderNumber = await nextOrderNumber(orgId, businessDay);
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

  /*
   * Reading the highest number and then inserting is two statements, so two
   * checkouts in the same moment can read the same number. Rather than lock
   * the table for every order at a single outlet, the unique constraint is
   * allowed to catch it and the number is recomputed — the second attempt
   * reads the row the first one just wrote.
   */
  const insertOrder = () =>
    database
      .insert(orders)
      .values({
      orgId,
      locationId,
      orderNumber,
      businessDate: businessDay,
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
      subtotal: totals.listed,
      discountTotal: totals.discount,
      promotionCode: cart.promotion?.code,
      pointsRedeemed: cart.points?.points ?? 0,
      taxableTotal: totals.taxable,
      cgstTotal: totals.cgst,
      sgstTotal: totals.sgst,
      igstTotal: totals.igst,
      taxTotal: totals.total,
      stampRewardApplied: cart.stampReward !== null,
      stampRewardDiscount: cart.stampReward?.discount ?? ZERO,
      // What is actually charged: the fee-inclusive, fully discounted total,
      // less any points spent. Points are tender rather than a discount, so
      // the payment row and this figure agree with the cash that changes
      // hands.
      grandTotal: payable,
      placedAt: now,
      })
      .returning();

  let order: Awaited<ReturnType<typeof insertOrder>>[number] | undefined;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      [order] = await insertOrder();
      break;
    } catch (error) {
      // 23505 is unique_violation. Anything else is a real failure.
      const code = (error as { cause?: { code?: string }; code?: string }).cause?.code
        ?? (error as { code?: string }).code;
      if (code !== "23505" || attempt === 3) throw error;
      orderNumber = await nextOrderNumber(orgId, businessDay);
    }
  }

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

  /*
   * Remember the address, so it never has to be typed twice.
   *
   * Matched on the pin and the first line rather than inserted every time: the
   * same doorstep ordered from twice is one address, and a list that grows a
   * duplicate on every order is a list nobody will scroll.
   */
  if (fulfilment === "DELIVERY" && pin && customer) {
    const [existing] = await database
      .select()
      .from(addresses)
      .where(
        and(
          eq(addresses.customerId, customer.id),
          eq(addresses.latMicro, pin.latMicro),
          eq(addresses.lngMicro, pin.lngMicro),
        ),
      )
      .limit(1);

    if (existing) {
      await database
        .update(addresses)
        .set({ line1: details.addressLine1 ?? existing.line1, landmark: details.landmark, updatedAt: now })
        .where(eq(addresses.id, existing.id));
    } else {
      await database.insert(addresses).values({
        orgId,
        customerId: customer.id,
        line1: details.addressLine1 ?? "",
        landmark: details.landmark,
        city: "Ambala City",
        latMicro: pin.latMicro,
        lngMicro: pin.lngMicro,
      });
    }
  }

  // What the order is waiting on. Cash at the counter, recorded now so the
  // till has a row to settle against rather than an implicit expectation.
  // `payable`, not `cart.payable` — the cart's own figure never carries a
  // delivery fee, because priceCart prices the food before the fee is known.
  await createPendingPayment({ orgId, orderId: order.id, amount: payable });

  /*
   * Spend the points, and count the code.
   *
   * Both happen only once the order row exists. Deducting a balance for an
   * order that then failed to write would take points for food nobody ordered.
   */
  if (cart.points && customer) {
    const [account] = await database
      .select()
      .from(loyaltyAccounts)
      .where(eq(loyaltyAccounts.customerId, customer.id))
      .limit(1);

    if (account) {
      await database
        .update(loyaltyAccounts)
        .set({ pointsBalance: account.pointsBalance - cart.points.points, updatedAt: now })
        .where(eq(loyaltyAccounts.id, account.id));

      await database.insert(loyaltyTransactions).values({
        orgId,
        accountId: account.id,
        points: -cart.points.points,
        reason: `Spent on order #${orderNumber}`,
        orderId: order.id,
      });
    }
  }

  if (cart.promotion) {
    await countPromotionUse(orgId, cart.promotion.code);
  }

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
  /**
   * When the kitchen said it would be ready, and whether that moment has
   * passed.
   *
   * The comparison happens here rather than in the page because reading the
   * clock is not a pure operation, and a component that does it mid-render can
   * give two different answers in one pass.
   */
  readonly readyEta: { at: Date; passed: boolean } | null;
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
    readyEta: order.estimatedReadyAt
      ? { at: order.estimatedReadyAt, passed: order.estimatedReadyAt.getTime() <= Date.now() }
      : null,
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
  readonly estimatedReadyAt: Date | null;
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
    estimatedReadyAt: row.estimatedReadyAt,
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

/** What the kitchen needs on paper. Nothing here is a price — a KOT is not a bill. */
export interface KotOrder {
  readonly id: string;
  readonly orderNumber: string;
  readonly channel: OrderChannel;
  readonly fulfilment: FulfilmentType;
  readonly tableLabel: string | null;
  readonly customerName: string | null;
  readonly notes: string | null;
  readonly placedAt: Date | null;
  readonly items: readonly { name: string; quantity: number; modifiers: readonly string[] }[];
}

/**
 * One order, for the kitchen ticket. Scoped by both id and org — the id
 * alone would let a stray order id from another tenant print here, since
 * the app queries as `postgres` and bypasses row-level security.
 *
 * Unlike `listActiveOrders`, this does not exclude terminal orders: a
 * printer jam or a torn ticket is a reason to reprint one that has already
 * moved on.
 */
export async function getKotOrder(orderId: string, orgId: string): Promise<KotOrder | null> {
  const database = db();
  const [row] = await database
    .select()
    .from(orders)
    .where(and(eq(orders.id, orderId), eq(orders.orgId, orgId)))
    .limit(1);
  if (!row) return null;

  const items = await database.select().from(orderItems).where(eq(orderItems.orderId, row.id));
  const itemIds = items.map((item) => item.id);
  const mods =
    itemIds.length > 0
      ? await database.select().from(orderItemModifiers).where(inArray(orderItemModifiers.orderItemId, itemIds))
      : [];

  return {
    id: row.id,
    orderNumber: row.orderNumber,
    channel: row.channel,
    fulfilment: row.fulfilment,
    tableLabel: row.tableLabel,
    customerName: row.customerName,
    notes: row.notes,
    placedAt: row.placedAt,
    items: items.map((item) => ({
      name: item.productName,
      quantity: item.quantity,
      modifiers: mods.filter((mod) => mod.orderItemId === item.id).map((mod) => mod.modifierName),
    })),
  };
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

/* ------------------------------------------------------------------ */
/* Riders                                                              */
/* ------------------------------------------------------------------ */

/** Deliveries currently on the road. */
export async function listDeliveries(orgId: string): Promise<readonly StaffOrderView[]> {
  const all = await listActiveOrders(orgId);
  return all.filter(
    (order) => order.fulfilment === "DELIVERY" && (order.status === "READY" || order.status === "OUT_FOR_DELIVERY"),
  );
}

/**
 * Closes a delivery: records the cash taken at the door and marks it delivered.
 *
 * One action, because at the door they are one event. Splitting them would let
 * a rider mark an order delivered and forget the money, or record money for an
 * order still in the bag.
 *
 * Deliberately narrow: it only touches an order that is already out for
 * delivery. A rider's phone cannot move any other ticket in the shop.
 */
export async function completeDelivery(input: {
  orderId: string;
  actorUserId: string;
  actorRoles: readonly Role[];
  orgId: string;
  /** False when the customer had already paid some other way. */
  cashCollected: boolean;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const database = db();
  const [order] = await database
    .select()
    .from(orders)
    .where(and(eq(orders.id, input.orderId), eq(orders.orgId, input.orgId)))
    .limit(1);

  if (!order) return { ok: false, error: "That delivery does not exist." };

  if (order.fulfilment !== "DELIVERY") {
    return { ok: false, error: "That order is not a delivery." };
  }

  if (order.status !== "OUT_FOR_DELIVERY") {
    return {
      ok: false,
      error:
        order.status === "COMPLETED"
          ? "That delivery is already closed."
          : "That order has not left the shop yet.",
    };
  }

  if (input.cashCollected) {
    const paid = await recordCashPayment({
      orderId: order.id,
      actorUserId: input.actorUserId,
      actorRoles: input.actorRoles,
    });
    // "Already paid" is not a failure here — it means someone recorded it
    // first, and the delivery should still close.
    if (!paid.ok && !paid.error.includes("already been paid")) {
      return { ok: false, error: paid.error };
    }
  }

  return advanceOrder({
    orderId: order.id,
    to: "COMPLETED",
    actorUserId: input.actorUserId,
    orgId: input.orgId,
  });
}

/**
 * Accepts an order and says when it will be ready.
 *
 * The estimate is stored as an instant rather than a number of minutes.
 * "Twenty minutes" is only true at the moment it is said; a customer who
 * reloads ten minutes later should see ten, not twenty again.
 */
export async function acceptOrder(input: {
  orderId: string;
  prepMinutes: number;
  actorUserId: string;
  orgId: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const minutes = Math.round(input.prepMinutes);
  if (!Number.isFinite(minutes) || minutes < 1 || minutes > 240) {
    return { ok: false, error: "That is not a sensible preparation time." };
  }

  const advanced = await advanceOrder({
    orderId: input.orderId,
    to: "ACCEPTED",
    actorUserId: input.actorUserId,
    orgId: input.orgId,
  });
  if (!advanced.ok) return advanced;

  await db()
    .update(orders)
    .set({ estimatedReadyAt: new Date(Date.now() + minutes * 60_000), updatedAt: new Date() })
    .where(and(eq(orders.id, input.orderId), eq(orders.orgId, input.orgId)));

  return { ok: true };
}

/**
 * Turns an order down, with a reason.
 *
 * The reason is stored on the order as well as on the event, because "why do
 * we reject orders" is a question worth being able to count — refusing four
 * orders for being out of area is a radius problem, refusing four for sold-out
 * is a prep problem, and only a structured value tells them apart.
 */
export async function rejectOrder(input: {
  orderId: string;
  reason: RejectionReason;
  note?: string;
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

  const captured = await database
    .select({ id: payments.id })
    .from(payments)
    .where(and(eq(payments.orderId, order.id), eq(payments.status, "CAPTURED")))
    .limit(1);

  // Refusing an order that has already been paid for means money has to go
  // back, and that is a refund with its own permission and its own trail —
  // not something to do silently from a pop-up.
  if (captured.length > 0) {
    return { ok: false, error: "This order has been paid for. It needs a refund rather than a rejection." };
  }

  try {
    assertTransition(order.status, "CANCELLED", order.fulfilment);
  } catch {
    return { ok: false, error: `An order that is ${order.status.toLowerCase()} cannot be turned down.` };
  }

  const detail = input.note?.trim() ? `${REJECTION_LABELS[input.reason]} — ${input.note.trim()}` : REJECTION_LABELS[input.reason];

  await database
    .update(orders)
    .set({ status: "CANCELLED", cancellationReason: detail, updatedAt: new Date() })
    .where(eq(orders.id, order.id));

  await database.insert(orderEvents).values({
    orgId: input.orgId,
    orderId: order.id,
    fromStatus: order.status,
    toStatus: "CANCELLED",
    actorUserId: input.actorUserId,
    reason: detail,
  });

  return { ok: true };
}
