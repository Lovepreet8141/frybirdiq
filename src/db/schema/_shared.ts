/**
 * Shared column builders. BUILD-PLAN.md §50, §51, §42.
 *
 * Two rules are enforced here rather than repeated in every table:
 *
 * Money is `bigint` paise. Never `numeric`, never `real`, never `double`.
 * Drizzle is told `mode: "bigint"` so a money column round-trips as a JS
 * bigint and can go straight into `lib/money` without a conversion step where
 * precision could be lost.
 *
 * Every operational row carries `org_id`. Row-level security keys off it, and
 * §42 is explicit that multi-location cannot be bolted on after a single-store
 * schema has set: "Do not retrofit multi-location after the single-store
 * schema is already deeply coupled."
 */

import { sql } from "drizzle-orm";
import { bigint, pgEnum, timestamp, uuid } from "drizzle-orm/pg-core";

/** An amount in paise. The only way money enters the schema. */
export const money = (name: string) => bigint(name, { mode: "bigint" });

/** Basis points, so rates stay exact: 5% is 500, 22.5% is 2250. */
export { integer as rateBps } from "drizzle-orm/pg-core";

export const primaryId = () => uuid("id").primaryKey().defaultRandom();

export const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
};

/**
 * Zero rupees, as a SQL literal.
 *
 * drizzle-kit serialises defaults to JSON to diff them, and `JSON.stringify`
 * cannot represent a bigint — `.default(0n)` breaks migration generation. A
 * SQL literal produces the same `DEFAULT 0` without going through JSON.
 */
export const ZERO_MONEY = sql`0`;

/**
 * Whether a listed price already contains GST.
 *
 * This is one decision for the whole business, so it lives on `organizations`
 * and nowhere else. It was previously a column on `products`, which meant the
 * answer could drift item by item — and the difference between the two modes
 * is 5% of every total, so drift here is silent revenue error.
 *
 * See src/lib/pricing.
 */
export const priceBasisEnum = pgEnum("price_basis", ["exclusive", "inclusive"]);
