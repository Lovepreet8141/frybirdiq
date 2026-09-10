/** Customers, addresses, loyalty, consent. BUILD-PLAN.md §29, §30, §83. */

import { boolean, index, integer, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
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
