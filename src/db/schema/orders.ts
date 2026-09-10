/** Orders, items, events, payments, refunds. BUILD-PLAN.md §16, §17, §43, §51. */

import { index, integer, jsonb, pgEnum, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { FULFILMENT_TYPES, ORDER_STATUSES } from "@/domain/order-status";
import { ORDER_SOURCES } from "@/domain/order-source";
import { customers } from "./customers";
import { modifiers, products } from "./menu";
import { locations, organizations } from "./tenancy";
import { ZERO_MONEY, money, primaryId, timestamps } from "./_shared";

export const orderStatusEnum = pgEnum("order_status", ORDER_STATUSES);
export const orderSourceEnum = pgEnum("order_source", ORDER_SOURCES);
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
  "AGGREGATOR",
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

    status: orderStatusEnum("status").notNull().default("DRAFT"),
    source: orderSourceEnum("source").notNull(),
    fulfilment: fulfilmentTypeEnum("fulfilment").notNull(),

    customerId: uuid("customer_id").references(() => customers.id, { onDelete: "set null" }),
    /** Copied at order time so a later profile edit cannot rewrite history. */
    customerName: text("customer_name"),
    customerPhone: text("customer_phone"),
    deliveryAddress: jsonb("delivery_address").$type<Record<string, string>>(),
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

    /* What the aggregator keeps. Recorded on the order because the difference
       between gross and net payout is the margin story for this business. */
    commissionAmount: money("commission_amount").notNull().default(ZERO_MONEY),
    /** What actually lands in the bank for this order. */
    netPayout: money("net_payout"),

    promotionCode: text("promotion_code"),
    notes: text("notes"),
    /** The aggregator's own id, so an imported order can be reconciled. */
    externalRef: text("external_ref"),

    placedAt: timestamp("placed_at", { withTimezone: true }),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    readyAt: timestamp("ready_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    scheduledFor: timestamp("scheduled_for", { withTimezone: true }),

    ...timestamps,
  },
  (table) => [
    unique("orders_org_number_unique").on(table.orgId, table.orderNumber),
    unique("orders_source_external_ref_unique").on(table.source, table.externalRef),
    index("orders_org_status_idx").on(table.orgId, table.status),
    index("orders_location_placed_idx").on(table.locationId, table.placedAt),
    index("orders_source_idx").on(table.orgId, table.source),
    index("orders_customer_idx").on(table.customerId),
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
    /** Kept separate from the amount so a settlement report reconciles. */
    feeAmount: money("fee_amount").notNull().default(ZERO_MONEY),

    /** "razorpay", "cash", "swiggy". Never a provider-specific column. §3. */
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
