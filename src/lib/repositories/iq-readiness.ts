import "server-only";

/**
 * IQ READINESS counts (read-only): five measures of how complete the shop's own
 * record-keeping is, each counted from stored rows for the last 7 FINISHED
 * business days and again for the 7 before them (so the panel can show a trend).
 * Nothing is written and nothing is estimated; the pure `buildReadiness` turns
 * these counts into percents and words.
 *
 * Every query scopes by org_id itself. Today is left out of every window: a day
 * in progress cannot yet be "closed the same day".
 *
 * Reads live tables, not `iq_daily_trust`: no fact job is scheduled in
 * production, so that table is empty, and a readiness screen that waited for a
 * job would say nothing.
 */

import { sql } from "drizzle-orm";
import { db } from "@/db";
import { addDays, businessDate } from "@/lib/dates";
import { type Readiness, type ReadinessRaw, buildReadiness } from "@/lib/iq/readiness/scores";

const DAY_MS = 24 * 60 * 60 * 1000;
const TOP_ITEMS = 20;
const TOP_ITEMS_DAYS = 30;
const COUNT_WINDOW_DAYS = 7;

interface Window {
  readonly from: string;
  readonly to: string;
}

/** The last 7 finished business days, and the 7 before them. */
export function readinessWindows(now: Date): { readonly current: Window; readonly previous: Window } {
  const today = businessDate(now);
  return {
    current: { from: addDays(today, -7), to: addDays(today, -1) },
    previous: { from: addDays(today, -14), to: addDays(today, -8) },
  };
}

const n = (value: unknown): number => Number(value ?? 0);

/** Orders placed in the window, and how many were completed or cancelled before their own business day ended. */
async function closedSameDay(orgId: string, w: Window): Promise<{ numerator: number; denominator: number }> {
  const [row] = await db().execute<{ closed: string; total: string }>(sql`
    SELECT
      count(*) FILTER (WHERE EXISTS (
        SELECT 1 FROM order_events e
        WHERE e.order_id = o.id
          AND e.to_status IN ('COMPLETED', 'CANCELLED', 'FAILED', 'REFUNDED')
          AND e.created_at < ((o.business_date + 1)::timestamp AT TIME ZONE 'Asia/Kolkata')
      )) AS closed,
      count(*) AS total
    FROM orders o
    WHERE o.org_id = ${orgId} AND o.business_date BETWEEN ${w.from} AND ${w.to} AND o.status <> 'DRAFT'`);
  return { numerator: n(row?.closed), denominator: n(row?.total) };
}

/** Completed orders that have a cash payment on them, and how many of those have the cash recorded as received. */
async function cashRecorded(orgId: string, w: Window): Promise<{ numerator: number; denominator: number }> {
  const [row] = await db().execute<{ recorded: string; total: string }>(sql`
    SELECT
      count(*) FILTER (WHERE EXISTS (
        SELECT 1 FROM payments p
        WHERE p.order_id = o.id AND p.org_id = o.org_id AND p.method = 'CASH' AND p.status IN ('CAPTURED', 'PARTIALLY_REFUNDED', 'REFUNDED')
      )) AS recorded,
      count(*) AS total
    FROM orders o
    WHERE o.org_id = ${orgId} AND o.business_date BETWEEN ${w.from} AND ${w.to} AND o.status = 'COMPLETED'
      AND EXISTS (SELECT 1 FROM payments p WHERE p.order_id = o.id AND p.org_id = o.org_id AND p.method = 'CASH')`);
  return { numerator: n(row?.recorded), denominator: n(row?.total) };
}

/** Orders in the window that are still live sales (not a draft, cancelled or failed), and how many carry a customer. */
async function customerAttached(orgId: string, w: Window): Promise<{ numerator: number; denominator: number }> {
  const [row] = await db().execute<{ attached: string; total: string }>(sql`
    SELECT count(o.customer_id) AS attached, count(*) AS total
    FROM orders o
    WHERE o.org_id = ${orgId} AND o.business_date BETWEEN ${w.from} AND ${w.to} AND o.status NOT IN ('DRAFT', 'CANCELLED', 'FAILED')`);
  return { numerator: n(row?.attached), denominator: n(row?.total) };
}

/**
 * The 20 items sold most in the last 30 finished days, and how many have a
 * costed recipe (a recipe with a current version: a bare header consumes
 * nothing). The trend counts the SAME 20 items against the recipes that existed
 * a week ago, so it moves only when someone adds a recipe.
 */
async function recipeCoverage(orgId: string, now: Date): Promise<ReadinessRaw["recipeCoverage"]> {
  const today = businessDate(now);
  const weekAgo = new Date(now.getTime() - COUNT_WINDOW_DAYS * DAY_MS).toISOString();
  const rows = await db().execute<{ name: string; has_recipe: boolean; had_recipe: boolean }>(sql`
    WITH top AS (
      SELECT oi.product_id, max(oi.product_name) AS name, sum(oi.quantity) AS units
      FROM order_items oi
      JOIN orders o ON o.id = oi.order_id AND o.org_id = ${orgId}
      WHERE oi.org_id = ${orgId} AND oi.product_id IS NOT NULL
        AND o.business_date BETWEEN ${addDays(today, -TOP_ITEMS_DAYS)} AND ${addDays(today, -1)}
        AND o.status NOT IN ('DRAFT', 'CANCELLED', 'FAILED')
      GROUP BY oi.product_id
      ORDER BY units DESC, name ASC
      LIMIT ${TOP_ITEMS}
    )
    SELECT t.name,
           (r.id IS NOT NULL AND r.current_version_id IS NOT NULL) AS has_recipe,
           (r.id IS NOT NULL AND r.current_version_id IS NOT NULL AND r.created_at <= ${weekAgo}::timestamptz) AS had_recipe
    FROM top t
    LEFT JOIN recipes r ON r.product_id = t.product_id AND r.org_id = ${orgId}
    ORDER BY t.units DESC, t.name ASC`);
  const list = [...rows];
  return {
    numerator: list.filter((r) => r.has_recipe).length,
    denominator: list.length,
    previousNumerator: list.filter((r) => r.had_recipe).length,
    previousDenominator: list.length,
    firstMissingItem: list.find((r) => !r.has_recipe)?.name ?? null,
  };
}

/**
 * Ingredients kept in stock, and how many had a physical count that CHANGED the
 * balance in the last 7 days. `countStock` writes an ADJUSTMENT with a
 * "Physical count:" note only when the count differs from the balance; a count
 * that matches leaves no row, so this is a floor, and the panel says so.
 */
async function stockCount(orgId: string, now: Date): Promise<ReadinessRaw["stockCount"]> {
  const t7 = new Date(now.getTime() - COUNT_WINDOW_DAYS * DAY_MS).toISOString();
  const t14 = new Date(now.getTime() - 2 * COUNT_WINDOW_DAYS * DAY_MS).toISOString();
  const nowIso = now.toISOString();
  const [row] = await db().execute<{ stocked: string; counted: string; counted_before: string; last_count: Date | string | null }>(sql`
    WITH stocked AS (SELECT DISTINCT ingredient_id FROM inventory_items WHERE org_id = ${orgId}),
    counts AS (
      SELECT ingredient_id, occurred_at FROM inventory_movements
      WHERE org_id = ${orgId} AND type = 'ADJUSTMENT' AND notes LIKE 'Physical count:%'
    )
    SELECT
      (SELECT count(*) FROM stocked) AS stocked,
      (SELECT count(*) FROM stocked s WHERE EXISTS (SELECT 1 FROM counts c WHERE c.ingredient_id = s.ingredient_id AND c.occurred_at > ${t7}::timestamptz AND c.occurred_at <= ${nowIso}::timestamptz)) AS counted,
      (SELECT count(*) FROM stocked s WHERE EXISTS (SELECT 1 FROM counts c WHERE c.ingredient_id = s.ingredient_id AND c.occurred_at > ${t14}::timestamptz AND c.occurred_at <= ${t7}::timestamptz)) AS counted_before,
      (SELECT max(occurred_at) FROM counts) AS last_count`);
  const last = row?.last_count ? new Date(row.last_count) : null;
  return {
    numerator: n(row?.counted),
    denominator: n(row?.stocked),
    previousNumerator: n(row?.counted_before),
    previousDenominator: n(row?.stocked),
    daysSinceLastCount: last ? Math.max(0, Math.floor((now.getTime() - last.getTime()) / DAY_MS)) : null,
  };
}

/** The five counts, this week and last, for one org. */
export async function getReadinessRaw(orgId: string, now: Date = new Date()): Promise<ReadinessRaw> {
  const { current, previous } = readinessWindows(now);
  const [closed, closedBefore, cash, cashBefore, customers, customersBefore, recipes, stock] = await Promise.all([
    closedSameDay(orgId, current),
    closedSameDay(orgId, previous),
    cashRecorded(orgId, current),
    cashRecorded(orgId, previous),
    customerAttached(orgId, current),
    customerAttached(orgId, previous),
    recipeCoverage(orgId, now),
    stockCount(orgId, now),
  ]);
  const pair = (a: { numerator: number; denominator: number }, b: { numerator: number; denominator: number }) => ({
    numerator: a.numerator,
    denominator: a.denominator,
    previousNumerator: b.numerator,
    previousDenominator: b.denominator,
  });
  return {
    closedSameDay: pair(closed, closedBefore),
    cashRecorded: pair(cash, cashBefore),
    recipeCoverage: recipes,
    stockCount: stock,
    customerAttached: pair(customers, customersBefore),
  };
}

export async function getReadiness(orgId: string, now: Date = new Date()): Promise<Readiness> {
  return buildReadiness(await getReadinessRaw(orgId, now));
}
