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

import { and, desc, eq, inArray, isNull, notInArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { addresses, customers, locations, loyaltyAccounts, loyaltyStampEvents, loyaltyTransactions, memberships, orderEvents, orderItemModifiers, orderItems, orders, organizations, payments, tables } from "@/db/schema";
import { assertChannelFulfilment, fulfilmentsFor, type OrderChannel } from "@/domain/order-channel";
import { type FulfilmentType, type OrderStatus, TERMINAL_STATUSES, assertTransition, foodWasCooking } from "@/domain/order-status";
import type { Role } from "@/domain/permissions";
import { REJECTION_LABELS, type RejectionReason } from "@/domain/rejection";
import { businessDate } from "@/lib/dates";
import { isValidScheduledTime } from "@/lib/cart/scheduled-time";
import { isSupabaseConfigured } from "@/lib/env";
import { type Paise, ZERO, formatINR, paise, subtract } from "@/lib/money";
import { type PricedOrder, priceOrder } from "@/lib/pricing";
import { fromMicro, toPoint } from "@/lib/delivery";
import { type SnapshotLineInput, snapshotLines } from "@/lib/orders/snapshot";
import type { CartLine } from "@/lib/cart/schema";
import { priceDraft } from "@/lib/pos/pricing";
import { quoteForPin } from "./delivery";
import { countPromotionUse } from "./promotions";
import { requireOrg, resolvePricingContext } from "./org";
import { ensureCustomerByPhone } from "./customers";
import { COUNTER_PLACED_STATUS } from "@/lib/pos/counter-placement";
import { getPricedCart } from "@/lib/cart";
import { getCustomer } from "@/lib/customer";
import { createPendingPayment, recordCashPayment } from "./payments";
import { CASH_PROVIDER, RAZORPAY_PROVIDER, availableMethods, codAllowed, getProvider, type PaymentMethod } from "@/lib/payments";
import { reverseStampForOrder } from "./loyalty";
import { recordConsumption, reverseConsumption } from "./stock";
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
  /** How the customer pays: online now (Razorpay) or on collection / at the door. Roadmap 1.2. */
  payment: z.enum(["COD", "ONLINE"]).default("COD"),

  /**
   * ASAP (the only choice before this) or a customer-picked time —
   * `orders.scheduledFor`, the requested/manual time distinct from
   * `estimatedReadyAt` (the kitchen's own promise, set at accept) and
   * `completedAt` (when it actually left). `scheduledFor` is a plain ISO
   * string here; the actual "is this a real, honourable slot" check happens
   * server-side against the org's real hours and the server's own clock, in
   * `placeOrder` below — never trusted from what the client computed.
   */
  when: z.enum(["ASAP", "SCHEDULED"]).default("ASAP"),
  scheduledFor: z.string().optional(),
});

export type CheckoutInput = z.infer<typeof checkoutSchema>;

export type PlaceOrderResult =
  | { ok: true; orderId: string; orderNumber: string; payment: "COD" | "ONLINE" }
  | { ok: false; error: string; fieldErrors?: Record<string, string> };

/**
 * The next order number, as the counter would call it out.
 *
 * A continuous sequence (order_number_seq, migration 0031) starting at 1225 —
 * it does not reset at the business-day boundary, so a number is never
 * repeated across days. `nextval()` is atomic under concurrent callers by
 * construction, which is also strictly safer than the MAX(order_number)+1
 * read this replaces: that version had to race another checkout landing in
 * the same millisecond and depended on the caller retrying on a unique
 * violation. `orders_org_day_number_unique` is unchanged — a globally-unique
 * value trivially satisfies a constraint that is only unique per org per day.
 *
 * Only ever called from inside persistOrder(), which itself is only ever
 * called from inside a withIdempotency() work callback — a retried request,
 * a double-tap or a receipt reprint replays the stored result and never
 * reaches this function, so a number is issued once per order, ever.
 */
async function nextOrderNumber(): Promise<string> {
  const [row] = await db().execute<{ next: string }>(sql`SELECT nextval('order_number_seq') AS next`);
  return String(row?.next);
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
   * A manual requested time, re-validated here against the server's own
   * clock and the org's real hours — never trusted from what the client's
   * picker computed. ASAP (the default) leaves `scheduledFor` unset,
   * exactly the existing behaviour, unchanged.
   */
  let scheduledFor: Date | null = null;
  if (details.when === "SCHEDULED") {
    const candidate = details.scheduledFor ? new Date(details.scheduledFor) : null;
    if (!candidate || !isValidScheduledTime(candidate, new Date(), org.openingTime, org.closingTime)) {
      return {
        ok: false,
        error: "That time isn't available anymore. Pick another.",
        fieldErrors: { scheduledFor: "Choose a time within opening hours, at least 20 minutes from now." },
      };
    }
    scheduledFor = candidate;
  }

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

  /*
   * How it is paid. The list of methods is the server's (keys present or
   * not); the choice is the customer's; the COD cap is the shop's. A
   * Razorpay Order is created before the order row exists so a gateway
   * failure leaves nothing half-written — the receipt is the checkout's own
   * idempotency key, and the pending payment row links it to the order.
   */
  const methods = availableMethods({ cash: org.cashEnabled, online: org.onlineEnabled });
  const onlineAvailable = methods.some((method) => method.choice === "ONLINE");
  let payment: { provider: string; method: PaymentMethod; providerOrderId: string | null };
  if (details.payment === "ONLINE") {
    if (!onlineAvailable) {
      return { ok: false, error: "Online payment isn't available right now. Choose pay on collection.", fieldErrors: { payment: "Not available right now." } };
    }
    try {
      const intent = await getProvider(RAZORPAY_PROVIDER).createIntent({ orderId: details.idempotencyKey, amount: payable, method: "UPI" });
      payment = { provider: RAZORPAY_PROVIDER, method: "UPI", providerOrderId: intent.providerOrderId };
    } catch (error) {
      return { ok: false, error: `We couldn't start the payment (${error instanceof Error ? error.message : "gateway error"}). Nothing has been charged — try again, or choose pay on collection.` };
    }
  } else {
    if (!methods.some((method) => method.choice === "COD")) {
      return { ok: false, error: "Pay on collection isn't available right now. Choose pay online.", fieldErrors: { payment: "Not available right now." } };
    }
    const cod = codAllowed(payable, onlineAvailable, paise(org.codCap));
    if (!cod.ok) return { ok: false, error: cod.reason, fieldErrors: { payment: cod.reason } };
    payment = { provider: CASH_PROVIDER, method: "CASH", providerOrderId: null };
  }

  try {
    const { result } = await withIdempotency(
      {
        key: details.idempotencyKey,
        operation: "placeOrder",
        orgId: org.id,
        // Full line content, not just a count and a total — two different
        // carts can share both (a same-price item swap) and a coarser
        // fingerprint would let a stale key from a lost-response retry
        // replay the *wrong* cart's order. Matches the precision
        // `placeCounterOrder`'s own fingerprint already uses below.
        request: {
          phone: details.phone,
          lines: cart.lines.map((line) => ({ slug: line.product.slug, quantity: line.quantity, modifiers: line.modifiers.map((modifier) => modifier.slug) })),
          promoCode: cart.promotion?.code ?? null,
          points: cart.points?.points ?? 0,
        },
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

  // The row, the §51 snapshots, the placement event and the pending payment —
  // through the same core the counter uses, so a website order and a till
  // order record exactly the same things. What is actually charged is the
  // fee-inclusive, fully discounted total less any points spent: points are
  // tender rather than a discount, so the payment row and `grandTotal` agree
  // with the cash that changes hands.
  const persisted = await persistOrder({
    orgId,
    locationId,
    channel,
    fulfilment,
    customerId: customer?.id ?? null,
    customerName: details.name,
    customerPhone: details.phone,
    notes: details.notes ?? null,
    tableId: null,
    lines: cart.lines,
    totals,
    payable,
    payment,
    actorUserId: null,
    eventReason: `Placed on the website for ${fulfilment === "DELIVERY" ? "delivery" : "collection"}`,
    extra: {
      scheduledFor,
      deliveryAddress:
        fulfilment === "DELIVERY"
          ? { line1: details.addressLine1 ?? "", landmark: details.landmark ?? "" }
          : null,
      deliveryLatMicro: pin?.latMicro ?? null,
      deliveryLngMicro: pin?.lngMicro ?? null,
      deliveryDistanceMetres: deliveryDistance,
      deliveryFee,
      promotionCode: cart.promotion?.code,
      pointsRedeemed: cart.points?.points ?? 0,
      stampRewardId: cart.stampReward?.rewardId,
      stampRewardProductSlug: cart.stampReward?.productSlug,
      stampRewardDiscount: cart.stampReward?.discount ?? ZERO,
    },
  });
  if (!persisted.ok) return persisted;
  const order = persisted.order;
  const orderNumber = order.orderNumber;

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

  return { ok: true, orderId: order.id, orderNumber, payment: details.payment };
  }
}

/* ------------------------------------------------------------------ */
/* Writing an order — one core, shared by the website and the counter  */
/* ------------------------------------------------------------------ */

export interface PersistOrderInput {
  readonly orgId: string;
  readonly locationId: string;
  readonly channel: OrderChannel;
  readonly fulfilment: FulfilmentType;
  readonly customerId: string | null;
  readonly customerName: string | null;
  readonly customerPhone: string | null;
  readonly notes: string | null;
  /** Dine-in only. Verified against the org by the caller. */
  readonly tableId: string | null;
  readonly lines: readonly SnapshotLineInput[];
  readonly totals: PricedOrder;
  /** What is actually charged — the pending payment row is opened for this. */
  readonly payable: Paise;
  /** How it will be paid. A provider-side order id when the caller already made one. */
  readonly payment: { readonly provider: string; readonly method: PaymentMethod; readonly providerOrderId: string | null };
  /** The member of staff who rang it up; null for a customer on the website. */
  readonly actorUserId: string | null;
  readonly eventReason: string;
  /** Channel-specific columns (delivery pin, promo, points, stamp reward) the core does not decide. */
  readonly extra?: Partial<typeof orders.$inferInsert>;
}

export type PersistOrderResult = { ok: true; order: typeof orders.$inferSelect } | { ok: false; error: string };

/**
 * The one write path for a new order: today's number, the order row, the
 * §51 snapshots of every line and modifier, the placement event, and the
 * pending payment the till settles against. The website's checkout and the
 * counter both come through here, so what an order *records* cannot differ
 * by where it was placed. No permission check — callers do that.
 *
 * Reading the highest number and then inserting is two statements, so two
 * checkouts in the same moment can read the same number. Rather than lock
 * the table for every order at a single outlet, the unique constraint is
 * allowed to catch it and the number is recomputed — the second attempt
 * reads the row the first one just wrote.
 */
export async function persistOrder(input: PersistOrderInput): Promise<PersistOrderResult> {
  const database = db();
  assertChannelFulfilment(input.channel, input.fulfilment);

  const businessDay = businessDate(new Date());
  const now = new Date();
  let orderNumber = await nextOrderNumber();

  const insertOrder = () =>
    database
      .insert(orders)
      .values({
        ...input.extra,
        orgId: input.orgId,
        locationId: input.locationId,
        orderNumber,
        businessDate: businessDay,
        customerId: input.customerId,
        status: "PENDING_PAYMENT",
        channel: input.channel,
        fulfilment: input.fulfilment,
        tableId: input.tableId,
        customerName: input.customerName,
        customerPhone: input.customerPhone,
        notes: input.notes,
        subtotal: input.totals.listed,
        discountTotal: input.totals.discount,
        taxableTotal: input.totals.taxable,
        cgstTotal: input.totals.cgst,
        sgstTotal: input.totals.sgst,
        igstTotal: input.totals.igst,
        taxTotal: input.totals.total,
        grandTotal: input.payable,
        placedAt: now,
      })
      .returning();

  let order: typeof orders.$inferSelect | undefined;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      [order] = await insertOrder();
      break;
    } catch (error) {
      // 23505 is unique_violation. Anything else is a real failure.
      const code = (error as { cause?: { code?: string }; code?: string }).cause?.code ?? (error as { code?: string }).code;
      if (code !== "23505" || attempt === 3) throw error;
      orderNumber = await nextOrderNumber();
    }
  }

  if (!order) return { ok: false, error: "The order could not be saved. Nothing has been charged." };

  // Name, price and tax rate are copied onto the line. Repricing the menu
  // tomorrow must not rewrite this order. §51.
  for (const { modifiers, ...columns } of snapshotLines(input.lines)) {
    const [item] = await database
      .insert(orderItems)
      // `productId` comes from the snapshot: the catalogue row for reporting,
      // beside the copied name and price the order actually keeps. §51.
      .values({ orgId: input.orgId, orderId: order.id, ...columns })
      .returning();

    if (item && modifiers.length > 0) {
      await database.insert(orderItemModifiers).values(
        modifiers.map((modifier) => ({
          orgId: input.orgId,
          orderItemId: item.id,
          groupName: modifier.groupName,
          modifierName: modifier.modifierName,
          priceDelta: modifier.priceDelta,
        })),
      );
    }
  }

  await database.insert(orderEvents).values({
    orgId: input.orgId,
    orderId: order.id,
    fromStatus: "DRAFT",
    toStatus: "PENDING_PAYMENT",
    actorUserId: input.actorUserId,
    reason: input.eventReason,
  });

  // What the order is waiting on, recorded now so the till has a row to
  // settle against rather than an implicit expectation.
  await createPendingPayment({
    orgId: input.orgId,
    orderId: order.id,
    amount: input.payable,
    provider: input.payment.provider,
    method: input.payment.method,
    providerOrderId: input.payment.providerOrderId,
  });

  return { ok: true, order };
}

export interface CounterOrderInput {
  readonly orgId: string;
  readonly lines: readonly CartLine[];
  readonly channel: "DINE_IN" | "TAKEAWAY";
  readonly tableId: string | null;
  readonly customerPhone: string | null;
  readonly notes: string | null;
  /** Minted by the till for this draft and sent with every attempt. §17. */
  readonly idempotencyKey: string;
  readonly actorUserId: string;
  /** Cash the customer handed over. Checked before anything is written. */
  readonly tendered: Paise;
}

export type CounterOrderResult =
  | { ok: true; orderId: string; orderNumber: string; total: Paise; replayed: boolean }
  | { ok: false; error: string };

/**
 * Rings an order up at the counter. BUILD-PLAN.md Phase 4.
 *
 * Prices the draft on the server (`priceDraft`, the same pass the grid was
 * shown), refuses anything the menu can no longer honour rather than
 * silently dropping it, attaches the customer if the till looked one up —
 * which is what lets FRYBIRD REWARDS act on the order at payment — checks
 * the cash covers the bill *before* anything is written, then persists
 * through the same `persistOrder` the website uses. The whole write is
 * idempotent on the till's key. Payment is the caller's next call —
 * `recordCashPayment`, unchanged — so an order whose cash somehow cannot be
 * recorded stays visible as unpaid on the Orders screen instead of vanishing.
 */
export async function placeCounterOrder(input: CounterOrderInput): Promise<CounterOrderResult> {
  const database = db();

  const org = await requireOrg();
  if (org.id !== input.orgId) return { ok: false, error: "That order does not belong to this shop." };
  if (input.lines.length === 0) return { ok: false, error: "Nothing has been added to this order." };

  const [location] = await database.select({ id: locations.id }).from(locations).where(eq(locations.orgId, input.orgId)).limit(1);
  if (!location) return { ok: false, error: "The shop is not set up yet." };

  const draft = await priceDraft(input.lines, input.channel);
  if (draft.rejected.length > 0) {
    return { ok: false, error: `Not available right now: ${draft.rejected.map((line) => line.slug).join(", ")}. Remove them and try again.` };
  }
  if (draft.lines.length === 0) return { ok: false, error: "Nothing has been added to this order." };

  const total = draft.totals.gross;
  if (input.tendered < total) return { ok: false, error: `Cash received is less than ${formatINR(total)}.` };

  const [fulfilment] = fulfilmentsFor(input.channel);
  if (!fulfilment) return { ok: false, error: "That order type is not valid." };

  let tableName: string | null = null;
  if (input.tableId) {
    if (fulfilment !== "DINE_IN") return { ok: false, error: "Only a dine-in order can be seated at a table." };
    const [table] = await database.select({ name: tables.name }).from(tables).where(and(eq(tables.id, input.tableId), eq(tables.orgId, input.orgId))).limit(1);
    if (!table) return { ok: false, error: "That table could not be found." };
    tableName = table.name;
  }

  // A phone offered at the counter enrols the customer: found, or created
  // with just the number. The order is then theirs, and the cash capture
  // credits stamps and points the way it does for every other channel.
  // No phone, no record — "No phone on file", nothing credited.
  const customer = input.customerPhone ? await ensureCustomerByPhone(input.orgId, input.customerPhone) : null;

  try {
    const { result, replayed } = await withIdempotency(
      {
        key: input.idempotencyKey,
        operation: "placeCounterOrder",
        orgId: input.orgId,
        request: { lines: input.lines, channel: input.channel, tableId: input.tableId, phone: input.customerPhone },
      },
      async () => {
        const persisted = await persistOrder({
          orgId: input.orgId,
          locationId: location.id,
          channel: input.channel,
          fulfilment,
          customerId: customer?.id ?? null,
          customerName: customer?.name ?? null,
          customerPhone: customer?.phone ?? input.customerPhone,
          notes: input.notes,
          tableId: input.tableId,
          lines: draft.lines,
          totals: draft.totals,
          payable: total,
          payment: { provider: CASH_PROVIDER, method: "CASH", providerOrderId: null },
          actorUserId: input.actorUserId,
          eventReason: `Rung up at the counter — ${input.channel === "DINE_IN" ? (tableName ? `dine-in, ${tableName}` : "dine-in") : "takeaway"}`,
        });
        if (!persisted.ok) return { ok: false as const, error: persisted.error };

        /*
         * Accepted at placement. The cashier ringing this up is the person
         * who would otherwise be asked to accept it, so the order goes
         * straight onto the kitchen display and never opens the new-order
         * pop-up. Done here, inside the idempotent placement, so a replay
         * neither repeats it nor re-creates the order. The transition is the
         * domain's own (PENDING_PAYMENT → ACCEPTED, legal for both counter
         * channels) and is recorded as an event with the cashier as actor.
         *
         * Best effort, deliberately: the order row exists and the cash is
         * about to be taken against it. Failing placement because the accept
         * step hit an infrastructure error would make the till retry — and a
         * retry that re-ran this callback would ring the order up twice. If
         * it ever fails the order stays PENDING_PAYMENT and the counter
         * accepts it by hand, which is what happened before this step.
         */
        await advanceOrder({ orderId: persisted.order.id, to: COUNTER_PLACED_STATUS, actorUserId: input.actorUserId, orgId: input.orgId });

        // Stored as the idempotent response, so it must survive JSON: the total travels as a string.
        return { ok: true as const, orderId: persisted.order.id, orderNumber: persisted.order.orderNumber, total: persisted.order.grandTotal.toString() };
      },
    );
    if (!result.ok) return result;
    return { ok: true, orderId: result.orderId, orderNumber: result.orderNumber, total: paise(BigInt(result.total)), replayed };
  } catch (error) {
    if (error instanceof IdempotencyConflict) return { ok: false, error: "That looks like a repeat of a different order. Start it again." };
    throw error;
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
  /** What the customer asked for at checkout, when they chose a time instead of ASAP. */
  readonly scheduledFor: Date | null;
  readonly grandTotal: bigint;
  readonly placedAt: Date | null;
  readonly items: readonly { name: string; quantity: number; total: bigint; modifiers: string[] }[];
  /** Whether FRYBIRD REWARDS actually granted a stamp for this order — only true once paid. */
  readonly stampEarned: boolean;
  /** What FRYBIRD REWARDS took off this order, if it redeemed a free item. */
  readonly stampRewardDiscount: bigint;
  /** The payment the order is waiting on or was settled by — the latest row. Null only for an order with no payment row at all. */
  readonly payment: {
    readonly provider: string;
    readonly method: PaymentMethod;
    readonly status: "PENDING" | "AUTHORIZED" | "CAPTURED" | "FAILED" | "REFUNDED" | "PARTIALLY_REFUNDED";
    readonly amount: bigint;
    readonly providerOrderId: string | null;
    readonly failureReason: string | null;
  } | null;
  /** For the payment window's prefill. */
  readonly customerPhone: string | null;
  readonly customerEmail: string | null;
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

  const [stampEvent] = await database
    .select({ id: loyaltyStampEvents.id })
    .from(loyaltyStampEvents)
    .where(and(eq(loyaltyStampEvents.orderId, id), isNull(loyaltyStampEvents.reversedAt)))
    .limit(1);

  // Captured beats pending: once money has arrived that is the payment,
  // whatever other attempts were opened along the way.
  const paymentRows = await database.select().from(payments).where(eq(payments.orderId, id)).orderBy(desc(payments.createdAt));
  const paymentRow = paymentRows.find((row) => row.status === "CAPTURED") ?? paymentRows[0] ?? null;

  const [customerRow] = order.customerId
    ? await database.select({ email: customers.email }).from(customers).where(eq(customers.id, order.customerId)).limit(1)
    : [];

  return {
    id: order.id,
    orderNumber: order.orderNumber,
    status: order.status,
    fulfilment: order.fulfilment,
    invoiceNumber: order.invoiceNumber,
    customerName: order.customerName,
    customerPhone: order.customerPhone,
    customerEmail: customerRow?.email ?? null,
    payment: paymentRow
      ? {
          provider: paymentRow.provider,
          method: paymentRow.method,
          status: paymentRow.status,
          amount: paymentRow.amount,
          providerOrderId: paymentRow.providerOrderId,
          failureReason: paymentRow.failureReason,
        }
      : null,
    readyEta: order.estimatedReadyAt
      ? { at: order.estimatedReadyAt, passed: order.estimatedReadyAt.getTime() <= Date.now() }
      : null,
    scheduledFor: order.scheduledFor,
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
    stampEarned: Boolean(stampEvent),
    stampRewardDiscount: order.stampRewardDiscount,
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
  /** The customer record, when the order was placed against one — what Customer 360 is keyed on. */
  readonly customerId: string | null;
  readonly grandTotal: Paise;
  readonly isPaid: boolean;
  readonly invoiceNumber: string | null;
  readonly estimatedReadyAt: Date | null;
  /** The customer's own requested time, when they chose one instead of ASAP — distinct from `estimatedReadyAt` (the kitchen's promise). */
  readonly scheduledFor: Date | null;
  readonly placedAt: Date | null;
  readonly notes: string | null;
  /** Where it came from — the website, or the counter as dine-in/takeaway. */
  readonly channel: OrderChannel;
  /** The table a dine-in order was seated at, if any. */
  readonly tableName: string | null;
  /** The member of staff who rang it up; null for a website order. */
  readonly placedBy: string | null;
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

  const tableIds = rows.map((row) => row.tableId).filter((id): id is string => id !== null);
  const tableRows = tableIds.length > 0 ? await database.select({ id: tables.id, name: tables.name }).from(tables).where(inArray(tables.id, tableIds)) : [];
  const tableNames = new Map(tableRows.map((table) => [table.id, table.name]));

  // Who rang it up: the placement event's actor, resolved to a display name.
  const placements = await database
    .select({ orderId: orderEvents.orderId, actorUserId: orderEvents.actorUserId })
    .from(orderEvents)
    .where(and(inArray(orderEvents.orderId, ids), eq(orderEvents.fromStatus, "DRAFT")));
  const actorIds = [...new Set(placements.map((event) => event.actorUserId).filter((id): id is string => id !== null))];
  const staffRows =
    actorIds.length > 0
      ? await database.select({ userId: memberships.userId, displayName: memberships.displayName }).from(memberships).where(and(eq(memberships.orgId, orgId), inArray(memberships.userId, actorIds)))
      : [];
  const staffNames = new Map(staffRows.map((staff) => [staff.userId, staff.displayName]));
  const placedBy = new Map(placements.map((event) => [event.orderId, event.actorUserId ? (staffNames.get(event.actorUserId) ?? null) : null]));

  return rows.map((row) => ({
    id: row.id,
    orderNumber: row.orderNumber,
    status: row.status,
    fulfilment: row.fulfilment,
    channel: row.channel,
    tableName: row.tableId ? (tableNames.get(row.tableId) ?? null) : null,
    placedBy: placedBy.get(row.id) ?? null,
    customerName: row.customerName,
    customerPhone: row.customerPhone,
    customerId: row.customerId,
    grandTotal: paise(row.grandTotal),
    isPaid: paidOrderIds.has(row.id),
    invoiceNumber: row.invoiceNumber,
    estimatedReadyAt: row.estimatedReadyAt,
    scheduledFor: row.scheduledFor,
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

  /*
   * FRYBIRD REWARDS reverses automatically the moment an order is marked
   * refunded — whatever stamp it earned (if any) is voided here, same
   * transaction-adjacent moment as the status write, so there is no window
   * where a refunded order still counts toward the next free item. A no-op
   * if this order never earned a stamp, or already had one reversed.
   */
  if (input.to === "REFUNDED") {
    await reverseStampForOrder({ orgId: input.orgId, orderId: order.id, reason: `Order #${order.orderNumber} refunded` });
  }

  /*
   * Consumption on order — roadmap 3.4. Triggers at ACCEPTED, not COMPLETED:
   * the moment the kitchen commits to cooking something is the moment the
   * ingredients are actually used, regardless of how long handover takes
   * after. Reversed on CANCELLED only — never REFUNDED, a deliberate
   * distinction: a refund happens after the food may already be cooked and
   * handed over (the chicken was genuinely used), while a cancellation means
   * it never was.
   *
   * Both run after the status write, not inside it, and their own failure
   * never turns this into `{ ok: false }` — an order being accepted or
   * cancelled is the operationally urgent thing; a stock-consumption problem
   * (a broken recipe reference, say) is a data-quality issue to log and
   * surface separately, not a reason to leave the kitchen unable to move a
   * real order over an inventory bookkeeping wrinkle.
   */
  if (input.to === "ACCEPTED") {
    try {
      const lines = await database
        .select({ orderItemId: orderItems.id, productId: orderItems.productId, quantity: orderItems.quantity })
        .from(orderItems)
        .where(eq(orderItems.orderId, order.id));
      const consumed = await recordConsumption(input.orgId, input.actorUserId, { orderId: order.id, lines });
      if (!consumed.ok) {
        console.error(`orders: stock consumption failed for order ${order.id}: ${consumed.error}`);
      } else if (consumed.warnings.length > 0) {
        console.warn(`orders: stock consumption warnings for order ${order.id}`, consumed.warnings);
      }
    } catch (error) {
      console.error(`orders: stock consumption threw for order ${order.id}`, error);
    }
  }

  if (input.to === "CANCELLED") {
    try {
      // `order.status` here is the status *before* this transition (fetched
      // above, before the update) — the highest stage this order ever
      // reached, since the state machine never moves backwards.
      const wasCooking = foodWasCooking(order.status);
      const reversed = await reverseConsumption(input.orgId, input.actorUserId, order.id, `Order #${order.orderNumber} cancelled`, wasCooking);
      if (!reversed.ok) {
        console.error(`orders: stock reversal failed for order ${order.id}: ${reversed.error}`);
      } else if (reversed.movementsReversed > 0 || reversed.movementsWasted > 0) {
        // Worth a line in journalctl: which way a cancellation went matters
        // if someone later disputes a physical count or a waste figure.
        console.log(`orders: order ${order.id} cancelled — ${reversed.movementsReversed} ingredient(s) credited back, ${reversed.movementsWasted} recorded as waste (kitchen had started: ${wasCooking})`);
      }
    } catch (error) {
      console.error(`orders: stock reversal threw for order ${order.id}`, error);
    }
  }

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
      orgId: input.orgId,
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

  /*
   * `rejectOrder` writes CANCELLED directly, bypassing `advanceOrder` — so
   * its own reversal hook (see the `to === "CANCELLED"` branch there) never
   * fires for a rejection. An order can be rejected after ACCEPTED (kitchen
   * out of an ingredient mid-prep, say), so consumption may genuinely have
   * happened; `reverseConsumption` is itself idempotent and a no-op when it
   * has not. Same non-fatal handling as `advanceOrder`: an inventory problem
   * must never block turning an order down.
   */
  try {
    // Same reasoning as advanceOrder's CANCELLED branch: order.status here
    // is still the pre-transition value, the highest stage this order ever
    // reached.
    const wasCooking = foodWasCooking(order.status);
    const reversed = await reverseConsumption(input.orgId, input.actorUserId, order.id, detail, wasCooking);
    if (!reversed.ok) {
      console.error(`orders: stock reversal failed for order ${order.id}: ${reversed.error}`);
    } else if (reversed.movementsReversed > 0 || reversed.movementsWasted > 0) {
      console.log(`orders: order ${order.id} rejected — ${reversed.movementsReversed} ingredient(s) credited back, ${reversed.movementsWasted} recorded as waste (kitchen had started: ${wasCooking})`);
    }
  } catch (error) {
    console.error(`orders: stock reversal threw for order ${order.id}`, error);
  }

  return { ok: true };
}
