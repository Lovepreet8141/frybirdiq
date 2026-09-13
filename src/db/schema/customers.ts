/** Customers, addresses, loyalty, consent. BUILD-PLAN.md §29, §30, §83. */

import { sql } from "drizzle-orm";
import { boolean, check, index, integer, pgEnum, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { organizations } from "./tenancy";
import { money, primaryId, timestamps } from "./_shared";

export const customers = pgTable(
  "customers",
  {
    id: primaryId(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    /** Set when the customer has an account; null for guest checkout. §61. */
    userId: uuid("user_id"),
    name: text("name"),
    /** The identity that actually matters in India. E.164. */
    phone: text("phone"),
    email: text("email"),

    /** §83: consent is explicit and separately recorded, never assumed. */
    marketingConsent: boolean("marketing_consent").notNull().default(false),
    marketingConsentAt: timestamp("marketing_consent_at", { withTimezone: true }),
    /** §82: set when the customer asks to be forgotten, before the purge runs. */
    deletionRequestedAt: timestamp("deletion_requested_at", { withTimezone: true }),

    ...timestamps,
  },
  (table) => [
    unique("customers_org_phone_unique").on(table.orgId, table.phone),
    index("customers_org_idx").on(table.orgId),
  ],
);

export const addresses = pgTable(
  "addresses",
  {
    id: primaryId(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    label: text("label"),
    line1: text("line1").notNull(),
    line2: text("line2"),
    landmark: text("landmark"),
    city: text("city").notNull(),
    state: text("state"),
    pincode: text("pincode"),
    /**
     * The pin the customer dropped, in microdegrees.
     *
     * More useful to a rider than the address text. Street addresses in Ambala
     * are informal — "near the water tank, behind Sharma Sweets" — and
     * geocoding them is unreliable, so the pin is what navigates and the text
     * is what gets read out on the phone.
     */
    latMicro: integer("lat_micro"),
    lngMicro: integer("lng_micro"),
    isDefault: boolean("is_default").notNull().default(false),
    ...timestamps,
  },
  (table) => [index("addresses_customer_idx").on(table.customerId)],
);

export const loyaltyAccounts = pgTable(
  "loyalty_accounts",
  {
    id: primaryId(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" })
      .unique(),
    pointsBalance: integer("points_balance").notNull().default(0),
    /**
     * Progress toward the free item — "buy 7, get the 8th free." Orders since
     * the last reward, not points; resets to zero the moment a reward is
     * redeemed rather than banking past the goal.
     */
    /**
     * Stamps earned since the last reward unlocked — FRYBIRD REWARDS, the
     * one universal card. A cache, not the source of truth: it is always
     * recomputed from `loyalty_stamp_events` in the same transaction that
     * writes to it, never incremented on its own. Resets to zero the moment
     * `stampsRequired` unconsumed stamps unlock a row in `loyalty_rewards`.
     */
    stampCount: integer("stamp_count").notNull().default(0),
    tier: text("tier"),
    ...timestamps,
  },
);

/**
 * Every movement of points, never a bare balance update.
 *
 * Same principle as inventory in §24: the balance is a running total of
 * recorded events, so a disputed balance can always be explained.
 */
export const loyaltyTransactions = pgTable(
  "loyalty_transactions",
  {
    id: primaryId(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    accountId: uuid("account_id")
      .notNull()
      .references(() => loyaltyAccounts.id, { onDelete: "cascade" }),
    /** Positive to earn, negative to redeem. */
    points: integer("points").notNull(),
    reason: text("reason").notNull(),
    orderId: uuid("order_id"),
    ...timestamps,
  },
  (table) => [index("loyalty_transactions_account_idx").on(table.accountId)],
);

export const loyaltyRewardStatusEnum = pgEnum("loyalty_reward_status", ["AVAILABLE", "REDEEMED", "REVERSED"]);

/**
 * One unlocked free item — FRYBIRD REWARDS. Created the instant a customer's
 * seventh unconsumed stamp lands, independent of whether an earlier reward
 * on the same account has been redeemed yet: rewards stack rather than
 * overwrite, the same way real stamp cards do when someone keeps ordering
 * past the goal.
 *
 * `redeemedProductSlug` is a convenience snapshot for the account screen and
 * for staff — the order's own `order_items` row is the actual immutable
 * record (§51), copied at order time the same as every other line.
 */
export const loyaltyRewards = pgTable(
  "loyalty_rewards",
  {
    id: primaryId(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    accountId: uuid("account_id")
      .notNull()
      .references(() => loyaltyAccounts.id, { onDelete: "cascade" }),
    status: loyaltyRewardStatusEnum("status").notNull().default("AVAILABLE"),
    unlockedAt: timestamp("unlocked_at", { withTimezone: true }).notNull().defaultNow(),
    redeemedAt: timestamp("redeemed_at", { withTimezone: true }),
    redeemedOrderId: uuid("redeemed_order_id"),
    redeemedProductSlug: text("redeemed_product_slug"),
    /** Set when a contributing order is refunded before this reward was spent. */
    reversedAt: timestamp("reversed_at", { withTimezone: true }),
    reversalReason: text("reversal_reason"),
    ...timestamps,
  },
  (table) => [
    index("loyalty_rewards_account_idx").on(table.accountId),
    index("loyalty_rewards_account_status_idx").on(table.accountId, table.status),
  ],
);

/**
 * The stamp ledger — one row per order that ever earned a stamp, never a
 * bare counter. Same principle as the points ledger: a balance nobody can
 * explain is a balance a customer will dispute.
 *
 * `orderId` is unique. That is the idempotency guarantee §17 asks for here:
 * a payment webhook or a retried capture can call the award path twice for
 * the same order and the second attempt's insert simply conflicts rather
 * than minting a second stamp.
 *
 * `rewardId` is set the moment this stamp becomes one of the
 * `stampsRequired` that completed a cycle — null means "still counting
 * toward the next one." `reversedAt` marks a stamp voided by a refund on
 * its order; a reversed stamp keeps its row (never deleted) but no longer
 * counts toward anything.
 */
export const loyaltyStampEvents = pgTable(
  "loyalty_stamp_events",
  {
    id: primaryId(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    accountId: uuid("account_id")
      .notNull()
      .references(() => loyaltyAccounts.id, { onDelete: "cascade" }),
    orderId: uuid("order_id").notNull(),
    rewardId: uuid("reward_id").references(() => loyaltyRewards.id, { onDelete: "set null" }),
    reversedAt: timestamp("reversed_at", { withTimezone: true }),
    reversalReason: text("reversal_reason"),
    ...timestamps,
  },
  (table) => [
    index("loyalty_stamp_events_account_idx").on(table.accountId),
    unique("loyalty_stamp_events_order_unique").on(table.orderId),
  ],
);

export const promotions = pgTable(
  "promotions",
  {
    id: primaryId(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    /** Only a coupon has one; every other type is applied by its rules. Unique per org where set. */
    code: text("code"),
    name: text("name").notNull(),
    description: text("description"),
    /** Exactly one of these is set. */
    discountBps: integer("discount_bps"),
    discountAmount: money("discount_amount"),
    minOrderAmount: money("min_order_amount"),
    maxDiscountAmount: money("max_discount_amount"),
    startsAt: timestamp("starts_at", { withTimezone: true }),
    endsAt: timestamp("ends_at", { withTimezone: true }),
    usageLimit: integer("usage_limit"),
    usageCount: integer("usage_count").notNull().default(0),
    /** Mirrors `status = 'live'` — kept so the website's existing coupon path keeps reading one flag. */
    isActive: boolean("is_active").notNull().default(true),

    /*
     * The product-aware promotion model (src/lib/promotions/engine.ts).
     * Percent, flat, coupon, buy-one-get-one, buy-X-get-Y, combo, free
     * item, happy hour. Products are referenced by slug — the identity an
     * order line stores (§51); a renamed product keeps its slug.
     */
    type: text("type").notNull().default("coupon"),
    buyQty: integer("buy_qty").notNull().default(1),
    buyProducts: text("buy_products").array().notNull().default(sql`'{}'::text[]`),
    getQty: integer("get_qty").notNull().default(1),
    getProducts: text("get_products").array().notNull().default(sql`'{}'::text[]`),
    /** Discount on the "get" items, in basis points. 10000 is free. */
    getDiscountBps: integer("get_discount_bps").notNull().default(10000),
    products: text("products").array().notNull().default(sql`'{}'::text[]`),
    comboPrice: money("combo_price"),
    /** "HH:MM" in Asia/Kolkata; both null means all day. */
    startTime: text("start_time"),
    endTime: text("end_time"),
    /** Bit i (Monday = 0) set when the promotion runs that day. 127 is every day. */
    daysMask: integer("days_mask").notNull().default(127),
    customerSegment: text("customer_segment").notNull().default("everyone"),
    stacking: text("stacking").notNull().default("none"),
    /** Channels are the counter and the website — nothing else exists. Ticking one does not activate it; pushing does. */
    channelPos: boolean("channel_pos").notNull().default(false),
    channelWeb: boolean("channel_web").notNull().default(false),
    perCustomerLimit: integer("per_customer_limit"),
    /** draft → live → paused. Only a push or Activate makes it live. */
    status: text("status").notNull().default("draft"),
    liveSince: timestamp("live_since", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    unique("promotions_org_code_unique").on(table.orgId, table.code),
    check("promotions_type_check", sql`${table.type} IN ('percent','flat','coupon','bogo','bxgy','combo','freeitem','happyhour')`),
    check("promotions_status_check", sql`${table.status} IN ('draft','live','paused')`),
    check("promotions_segment_check", sql`${table.customerSegment} IN ('everyone','new','returning','members')`),
    check("promotions_stacking_check", sql`${table.stacking} IN ('none','allow')`),
    check("promotions_days_mask_check", sql`${table.daysMask} BETWEEN 0 AND 127`),
  ],
);
