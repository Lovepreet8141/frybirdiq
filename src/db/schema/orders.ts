/** Orders, items, events, payments, refunds. BUILD-PLAN.md §16, §17, §43, §51. */

import { sql } from "drizzle-orm";
import { check, date, index, integer, jsonb, pgEnum, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { FULFILMENT_TYPES, ORDER_STATUSES } from "@/domain/order-status";
import { ORDER_CHANNELS } from "@/domain/order-channel";
import { customers } from "./customers";
import { modifiers, products } from "./menu";
import { locations, organizations } from "./tenancy";
import { ZERO_MONEY, money, primaryId, timestamps } from "./_shared";

export const orderStatusEnum = pgEnum("order_status", ORDER_STATUSES);
export const orderChannelEnum = pgEnum("order_channel", ORDER_CHANNELS);
export const fulfilmentTypeEnum = pgEnum("fulfilment_type", FULFILMENT_TYPES);
export const paymentStatusEnum = pgEnum("payment_status", [
  "PENDING",
  "AUTHORIZED",
  "CAPTURED",
  "FAILED",
  "REFUNDED",
  "PARTIALLY_REFUNDED",
]);
export const paymentMethodEnum = pgEnum("payment_method", [
  // UPI first, because in Ambala it is how most people actually pay. §15
  // lists cash/card/online; that ordering is written for a different market.
  "UPI",
  "CASH",
  "CARD",
  "NETBANKING",
  "WALLET",
  "OTHER",
]);

export const orders = pgTable(
  "orders",
  {
    id: primaryId(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    locationId: uuid("location_id")
      .notNull()
      .references(() => locations.id, { onDelete: "restrict" }),

    /** Short human number the counter and kitchen say out loud. */
    orderNumber: text("order_number").notNull(),
    /**
     * The IST business day this order belongs to.
     *
     * Stored rather than derived, because it is half of the uniqueness rule for
     * order_number and a constraint cannot depend on a timezone conversion that
     * might be evaluated differently later. It is also the honest answer to
     * "which day's takings is this in", which created_at is not for anything
     * placed between midnight and 05:30 IST.
     */
    businessDate: date("business_date").notNull(),

    status: orderStatusEnum("status").notNull().default("DRAFT"),
    /**
     * Where the order came from. Drives the revenue split.
     *
     * Direct only — dine-in, counter, and FRYBIRD's own website. Distinct from
     * `fulfilment`, which is how the order is handed over: an online order may
     * be collected or delivered, and only `fulfilment` tells the kitchen
     * which. The two are constrained against each other below.
     */
    channel: orderChannelEnum("channel").notNull(),
    fulfilment: fulfilmentTypeEnum("fulfilment").notNull(),

    customerId: uuid("customer_id").references(() => customers.id, { onDelete: "set null" }),
    /** Copied at order time so a later profile edit cannot rewrite history. */
    customerName: text("customer_name"),
    customerPhone: text("customer_phone"),
    deliveryAddress: jsonb("delivery_address").$type<Record<string, string>>(),
    /** The pin, in microdegrees. What the rider navigates to. */
    deliveryLatMicro: integer("delivery_lat_micro"),
    deliveryLngMicro: integer("delivery_lng_micro"),
    /**
     * The distance the delivery fee was charged on, after the road factor.
     *
     * Stored so a fee can be explained months later without re-deriving it
     * from a pin and a rate table that may both have changed since.
     */
    deliveryDistanceMetres: integer("delivery_distance_metres"),
    tableLabel: text("table_label"),

    /* Money. Every figure is the server's own calculation — §13: "Never trust
       the client for totals." The client sends items, not amounts. */
    subtotal: money("subtotal").notNull().default(ZERO_MONEY),
    discountTotal: money("discount_total").notNull().default(ZERO_MONEY),
    /** Pre-tax value after discount. The GST taxable base. */
    taxableTotal: money("taxable_total").notNull().default(ZERO_MONEY),
    cgstTotal: money("cgst_total").notNull().default(ZERO_MONEY),
    sgstTotal: money("sgst_total").notNull().default(ZERO_MONEY),
    igstTotal: money("igst_total").notNull().default(ZERO_MONEY),
    taxTotal: money("tax_total").notNull().default(ZERO_MONEY),
    deliveryFee: money("delivery_fee").notNull().default(ZERO_MONEY),
    packagingFee: money("packaging_fee").notNull().default(ZERO_MONEY),
    tipAmount: money("tip_amount").notNull().default(ZERO_MONEY),
    grandTotal: money("grand_total").notNull().default(ZERO_MONEY),

    /** Points spent on this order, and what they took off. */
    pointsRedeemed: integer("points_redeemed").notNull().default(0),
    pointsEarned: integer("points_earned").notNull().default(0),

    /**
     * Tax invoice number. Unique and sequential within the financial year.
     *
     * Separate from `orderNumber`, which resets daily so the counter can call
     * it out — "#004" is said aloud, not filed. A GST invoice number has to be
     * unique across the year and gapless, which a daily counter is not.
     *
     * Issued when the order is paid, not when it is placed: an invoice records
     * a completed sale, and numbering unpaid orders leaves gaps in a sequence
     * that is supposed to have none.
     */
    invoiceNumber: text("invoice_number"),
    invoicedAt: timestamp("invoiced_at", { withTimezone: true }),

    /**
     * Why an order was turned down.
     *
     * A column rather than only an event, because "why do we reject orders" is
     * a question the dashboard should be able to answer — an order refused for
     * being outside the delivery area is a different problem from one refused
     * because the chicken ran out.
     */
    cancellationReason: text("cancellation_reason"),

    promotionCode: text("promotion_code"),
    notes: text("notes"),

    placedAt: timestamp("placed_at", { withTimezone: true }),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    readyAt: timestamp("ready_at", { withTimezone: true }),
    /**
     * When the kitchen said it would be ready, chosen at accept time.
     *
     * An instant rather than a number of minutes: "20 minutes" is only true at
     * the moment it is said, and a customer who reloads ten minutes later
     * should see ten minutes, not twenty again.
     */
    estimatedReadyAt: timestamp("estimated_ready_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    scheduledFor: timestamp("scheduled_for", { withTimezone: true }),

    ...timestamps,
  },
  (table) => [
    /*
     * Order numbers restart each day — a counter calling out "number seven" is
     * the point of them — so uniqueness is per business day, not for all time.
     * The old constraint spanned every day at once, which meant the first order
     * of the second day collided with the first order of the first and checkout
     * failed for everyone until midnight UTC moved again.
     */
    unique("orders_org_day_number_unique").on(table.orgId, table.businessDate, table.orderNumber),
    unique("orders_org_invoice_unique").on(table.orgId, table.invoiceNumber),
    index("orders_org_status_idx").on(table.orgId, table.status),
    index("orders_location_placed_idx").on(table.locationId, table.placedAt),
    // Revenue split by channel is the reporting question this column exists
    // to answer, so it is indexed with the date it will be grouped by.
    index("orders_channel_placed_idx").on(table.orgId, table.channel, table.placedAt),
    index("orders_customer_idx").on(table.customerId),
    // Mirrors assertChannelFulfilment in src/domain/order-channel.ts. A
    // service that forgets to call it still cannot write an incoherent pair —
    // a dine-in order that is out for delivery is not a state to recover from.
    check(
      "orders_channel_fulfilment_coherent",
      sql`(
        (${table.channel} = 'DINE_IN' AND ${table.fulfilment} = 'DINE_IN')
        OR (${table.channel} = 'TAKEAWAY' AND ${table.fulfilment} = 'TAKEAWAY')
        OR (${table.channel} = 'ONLINE' AND ${table.fulfilment} IN ('TAKEAWAY', 'DELIVERY'))
      )`,
    ),
  ],
);

/**
 * A line on an order.
 *
 * The product name, price and tax rate are copied onto the line, not looked up
 * through the foreign key. §51: "Changing today's menu price must never
 * rewrite yesterday's order." The `productId` is kept for reporting, and it is
 * `set null` on delete so removing a product from the menu cannot destroy the
 * sales history that explains last month's revenue.
 */
export const orderItems = pgTable(
  "order_items",
  {
    id: primaryId(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    productId: uuid("product_id").references(() => products.id, { onDelete: "set null" }),

    /* Snapshot. */
    productName: text("product_name").notNull(),
    productNameHi: text("product_name_hi"),
    quantity: integer("quantity").notNull().default(1),
    unitPrice: money("unit_price").notNull(),
    /** unitPrice + modifier deltas, times quantity, before discount. */
    lineSubtotal: money("line_subtotal").notNull(),
    lineDiscount: money("line_discount").notNull().default(ZERO_MONEY),
    taxRateBps: integer("tax_rate_bps").notNull().default(0),
    hsnCode: text("hsn_code"),
    lineTaxable: money("line_taxable").notNull().default(ZERO_MONEY),
    lineTax: money("line_tax").notNull().default(ZERO_MONEY),
    lineTotal: money("line_total").notNull(),

    notes: text("notes"),
    position: integer("position").notNull().default(0),
    ...timestamps,
  },
  (table) => [index("order_items_order_idx").on(table.orderId), index("order_items_product_idx").on(table.productId)],
);

export const orderItemModifiers = pgTable(
  "order_item_modifiers",
  {
    id: primaryId(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    orderItemId: uuid("order_item_id")
      .notNull()
      .references(() => orderItems.id, { onDelete: "cascade" }),
    modifierId: uuid("modifier_id").references(() => modifiers.id, { onDelete: "set null" }),
    /* Snapshot, for the same reason as the line above. */
    groupName: text("group_name").notNull(),
    modifierName: text("modifier_name").notNull(),
    priceDelta: money("price_delta").notNull().default(ZERO_MONEY),
    quantity: integer("quantity").notNull().default(1),
  },
  (table) => [index("order_item_modifiers_item_idx").on(table.orderItemId)],
);

/**
 * The append-only history of an order.
 *
 * Drives realtime (§18) and answers "who cancelled this and when" without
 * inference. Never updated, never deleted.
 */
export const orderEvents = pgTable(
  "order_events",
  {
    id: primaryId(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    fromStatus: orderStatusEnum("from_status"),
    toStatus: orderStatusEnum("to_status").notNull(),
    /** Null when the system moved it — a webhook, a timeout. */
    actorUserId: uuid("actor_user_id"),
    reason: text("reason"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("order_events_order_idx").on(table.orderId, table.createdAt)],
);

export const payments = pgTable(
  "payments",
  {
    id: primaryId(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "restrict" }),
    status: paymentStatusEnum("status").notNull().default("PENDING"),
    method: paymentMethodEnum("method").notNull(),
    amount: money("amount").notNull(),
    /** The payment gateway's cut. Kept separate so a payout reconciles. */
    feeAmount: money("fee_amount").notNull().default(ZERO_MONEY),

    /** "razorpay", "cash". Never a provider-specific column. §3. */
    provider: text("provider").notNull(),
    providerPaymentId: text("provider_payment_id"),
    providerOrderId: text("provider_order_id"),
    /** Untouched provider response, for disputes. */
    providerPayload: jsonb("provider_payload").$type<Record<string, unknown>>(),

    capturedAt: timestamp("captured_at", { withTimezone: true }),
    failureReason: text("failure_reason"),
    ...timestamps,
  },
  (table) => [
    unique("payments_provider_payment_unique").on(table.provider, table.providerPaymentId),
    index("payments_order_idx").on(table.orderId),
  ],
);

export const refunds = pgTable(
  "refunds",
  {
    id: primaryId(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    paymentId: uuid("payment_id")
      .notNull()
      .references(() => payments.id, { onDelete: "restrict" }),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "restrict" }),
    amount: money("amount").notNull(),
    reason: text("reason").notNull(),
    /** Refunds need `orders.refund`; the actor is recorded, never inferred. */
    actorUserId: uuid("actor_user_id"),
    provider: text("provider").notNull(),
    providerRefundId: text("provider_refund_id"),
    providerPayload: jsonb("provider_payload").$type<Record<string, unknown>>(),
    ...timestamps,
  },
  (table) => [index("refunds_order_idx").on(table.orderId)],
);

/**
 * A score out of five for a finished order. No comment field.
 *
 * Deliberately attached to an order rather than to a product or left open to
 * anyone: a rating nobody had to buy to leave is worth nothing, and within a
 * week it is worth less than nothing. One row per order, enforced by the
 * database rather than by the form, so a double-tap or a replayed request
 * cannot leave two.
 *
 * There is no text column and there is not going to be one. The owner asked
 * for a score without a comment, and half the reason ratings work here is that
 * leaving one costs a single tap — adding a textarea beside it turns a
 * two-second action into a writing task and most people would abandon it.
 */
export const orderRatings = pgTable(
  "order_ratings",
  {
    id: primaryId(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    /** 1 to 5. Constrained in the migration as well as in the action. */
    score: integer("score").notNull(),
    ...timestamps,
  },
  (table) => [
    unique("order_ratings_order_unique").on(table.orderId),
    index("order_ratings_org_idx").on(table.orgId, table.score),
    // The action validates this too. The database check is what holds when a
    // future script or a console session writes the row instead of the form.
    check("order_ratings_score_range", sql`${table.score} between 1 and 5`),
  ],
);
