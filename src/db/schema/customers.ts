/** Customers, addresses, loyalty, consent. BUILD-PLAN.md §29, §30, §83. */

import { boolean, index, integer, pgEnum, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
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

export const loyaltyStampEventKindEnum = pgEnum("loyalty_stamp_event_kind", ["EARNED", "REDEEMED"]);

/**
 * Every movement of the stamp card, for the same reason the points ledger
 * exists: a balance nobody can explain is a balance customers will dispute.
 * `countAfter` rather than a delta — a redemption is a reset to zero, not a
 * number that composes with what came before it.
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
    kind: loyaltyStampEventKindEnum("kind").notNull(),
    countAfter: integer("count_after").notNull(),
    orderId: uuid("order_id"),
    ...timestamps,
  },
  (table) => [index("loyalty_stamp_events_account_idx").on(table.accountId)],
);

export const promotions = pgTable(
  "promotions",
  {
    id: primaryId(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
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
    isActive: boolean("is_active").notNull().default(true),
    ...timestamps,
  },
  (table) => [unique("promotions_org_code_unique").on(table.orgId, table.code)],
);
