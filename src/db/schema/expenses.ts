/**
 * What the business spends.
 *
 * The ordering side of this app records every rupee coming in. Nothing recorded
 * what goes out, so gross margin was computable and net profit was not — the
 * number an owner actually needs was missing.
 *
 * Revenue is deliberately absent from this file. It is derived from `orders`,
 * which already holds every sale with its channel and timestamp. A separate
 * revenue table would be a second version of the truth, and the two would
 * disagree the first time an order was refunded.
 */

import { sql } from "drizzle-orm";
import { boolean, date, index, integer, pgEnum, pgTable, text, unique, uuid } from "drizzle-orm/pg-core";

import { money, primaryId, timestamps, ZERO_MONEY } from "./_shared";
import { organizations } from "./tenancy";
import { suppliers } from "./inventory";

/**
 * Whether a cost moves with volume.
 *
 * This is the distinction the whole P&L turns on. DIRECT costs scale with each
 * plate sold; FIXED costs arrive whether the shutter opens or not. Break-even
 * is meaningless without it, and lumping them together produces a "total cost"
 * that cannot answer either question an owner has.
 */
export const costBehaviourEnum = pgEnum("cost_behaviour", ["DIRECT", "FIXED"]);

export const expenseCadenceEnum = pgEnum("expense_cadence", [
  "ONE_OFF",
  "DAILY",
  "WEEKLY",
  "MONTHLY",
  "QUARTERLY",
  "YEARLY",
]);

/**
 * Where money is held. Cash in the drawer and money in the bank are both real
 * and separately countable, and an owner who cannot see the split cannot tell a
 * cash-flow problem from a profitability one.
 */
export const accountKindEnum = pgEnum("account_kind", ["CASH", "BANK", "UPI", "CARD"]);

export const accounts = pgTable(
  "accounts",
  {
    id: primaryId(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    kind: accountKindEnum("kind").notNull(),
    /** Balance when tracking started, so the running position has a base. */
    openingBalance: money("opening_balance").notNull().default(ZERO_MONEY),
    isActive: boolean("is_active").notNull().default(true),
    ...timestamps,
  },
  (table) => [
    unique("accounts_org_name_unique").on(table.orgId, table.name),
    index("accounts_org_idx").on(table.orgId),
  ],
);

export const expenseCategories = pgTable(
  "expense_categories",
  {
    id: primaryId(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    behaviour: costBehaviourEnum("behaviour").notNull(),
    /** Kept out of the P&L's operating section — drawings, loan principal. */
    isNonOperating: boolean("is_non_operating").notNull().default(false),
    sortOrder: integer("sort_order").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
    ...timestamps,
  },
  (table) => [
    unique("expense_categories_org_name_unique").on(table.orgId, table.name),
    index("expense_categories_org_idx").on(table.orgId),
  ],
);

/**
 * A recurring commitment — rent, a salary, a broadband bill.
 *
 * Stored as the commitment rather than as a year of rows: rent is one fact that
 * changes twice a decade, and a table of 120 identical rows makes the fact
 * harder to see and harder to correct. Expenses are generated from these.
 */
export const recurringExpenses = pgTable(
  "recurring_expenses",
  {
    id: primaryId(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    categoryId: uuid("category_id")
      .notNull()
      .references(() => expenseCategories.id, { onDelete: "restrict" }),
    description: text("description").notNull(),
    amount: money("amount").notNull(),
    cadence: expenseCadenceEnum("cadence").notNull(),
    /** Day of month for MONTHLY and longer, 1-28 so February always has one. */
    dayOfPeriod: integer("day_of_period").notNull().default(1),
    startsOn: date("starts_on").notNull(),
    /** Null while it is still running. */
    endsOn: date("ends_on"),
    supplierId: uuid("supplier_id").references(() => suppliers.id, { onDelete: "set null" }),
    accountId: uuid("account_id").references(() => accounts.id, { onDelete: "set null" }),
    isActive: boolean("is_active").notNull().default(true),
    ...timestamps,
  },
  (table) => [index("recurring_expenses_org_idx").on(table.orgId, table.isActive)],
);

/**
 * Money actually spent, on a date.
 *
 * `paidOn` is a plain date, not a timestamp: an owner records "the gas cylinder,
 * Tuesday", and a timestamp would invite a timezone question nobody asked. The
 * business day is already defined in IST by lib/dates.
 */
export const expenses = pgTable(
  "expenses",
  {
    id: primaryId(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    categoryId: uuid("category_id")
      .notNull()
      .references(() => expenseCategories.id, { onDelete: "restrict" }),
    description: text("description").notNull(),
    amount: money("amount").notNull(),
    paidOn: date("paid_on").notNull(),
    supplierId: uuid("supplier_id").references(() => suppliers.id, { onDelete: "set null" }),
    accountId: uuid("account_id").references(() => accounts.id, { onDelete: "set null" }),
    /** Set when generated from a commitment, so it is not double-counted. */
    recurringExpenseId: uuid("recurring_expense_id").references(() => recurringExpenses.id, {
      onDelete: "set null",
    }),
    reference: text("reference"),
    notes: text("notes"),
    ...timestamps,
  },
  (table) => [
    index("expenses_org_paid_idx").on(table.orgId, table.paidOn),
    index("expenses_org_category_idx").on(table.orgId, table.categoryId),
    unique("expenses_recurring_period_unique").on(table.recurringExpenseId, table.paidOn),
  ],
);

/**
 * What the owner is aiming at, so a report can say "behind" rather than only
 * stating a number. Null means no target set — the reports say nothing rather
 * than inventing one.
 */
export const targets = pgTable(
  "targets",
  {
    id: primaryId(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    /** The month this applies to, always the 1st. */
    month: date("month").notNull(),
    revenueTarget: money("revenue_target"),
    /** Basis points. 3200 means the owner wants food cost at 32%. */
    foodCostTargetBps: integer("food_cost_target_bps"),
    netMarginTargetBps: integer("net_margin_target_bps"),
    ...timestamps,
  },
  (table) => [unique("targets_org_month_unique").on(table.orgId, table.month)],
);
