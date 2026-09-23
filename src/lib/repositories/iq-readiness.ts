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
 *
 * `analytics-start-date`: every window here is clamped to the org's Opening
 * date by default (`clampSpanToLaunch`) — data recorded before a real go-live
 * is not a real trading day and would otherwise pollute the very first
 * readiness scores a shop sees. `includePreLaunch: true` turns the clamp off,
 * for the owner who wants to look at the full history anyway. `stockCount` is
 * deliberately NOT clamped: it measures whether an ingredient was physically
 * counted recently, a fact about inventory hygiene that a pre-launch order
 * has no bearing on.
 */

import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { organizations } from "@/db/schema";
import { addDays, businessDate } from "@/lib/dates";
import { clampSpanToLaunch } from "@/lib/iq/launch-window";
import { type Readiness, type ReadinessRaw, buildReadiness } from "@/lib/iq/readiness/scores";

const DAY_MS = 24 * 60 * 60 * 1000;
const TOP_ITEMS = 20;
const TOP_ITEMS_DAYS = 30;
const COUNT_WINDOW_DAYS = 7;

interface Window {
  readonly from: string;
  readonly to: string;
}

function calendarDaysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
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
async function recipeCoverage(orgId: string, now: Date, top: Window): Promise<ReadinessRaw["recipeCoverage"]> {
  const weekAgo = new Date(now.getTime() - COUNT_WINDOW_DAYS * DAY_MS).toISOString();
  const rows = await db().execute<{ name: string; has_recipe: boolean; had_recipe: boolean }>(sql`
    WITH top AS (
      SELECT oi.product_id, max(oi.product_name) AS name, sum(oi.quantity) AS units
      FROM order_items oi
      JOIN orders o ON o.id = oi.order_id AND o.org_id = ${orgId}
      WHERE oi.org_id = ${orgId} AND oi.product_id IS NOT NULL
        AND o.business_date BETWEEN ${top.from} AND ${top.to}
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
    // Calendar days in the shop's own timezone, so a count at 9 am yesterday reads "1 day", not "0 days" at 8 am today.
    daysSinceLastCount: last ? Math.max(0, calendarDaysBetween(businessDate(last), businessDate(now))) : null,
  };
}

/** The org's Opening date (`analytics-start-date`), or null if not set. A one-column read, kept local rather than pulled in from `getOverviewSettings` (a different module's, larger read). */
async function getOpenedOn(orgId: string): Promise<string | null> {
  const [org] = await db().select({ openedOn: organizations.openedOn }).from(organizations).where(eq(organizations.id, orgId));
  return org?.openedOn ?? null;
}

/**
 * The five counts, this week and last, for one org. `includePreLaunch: true`
 * (`analytics-start-date`) turns off the Opening-date clamp so the owner can
 * see the full history, pre-launch data and all.
 */
export async function getReadinessRaw(orgId: string, now: Date = new Date(), includePreLaunch = false): Promise<ReadinessRaw> {
  const openedOn = await getOpenedOn(orgId);
  const clamp = <T extends { readonly from: string; readonly to: string }>(w: T) => clampSpanToLaunch(w, openedOn, includePreLaunch);
  const { current, previous } = readinessWindows(now);
  const today = businessDate(now);
  const top = clamp({ from: addDays(today, -TOP_ITEMS_DAYS), to: addDays(today, -1) });
  const [closed, closedBefore, cash, cashBefore, customers, customersBefore, recipes, stock] = await Promise.all([
    closedSameDay(orgId, clamp(current)),
    closedSameDay(orgId, clamp(previous)),
    cashRecorded(orgId, clamp(current)),
    cashRecorded(orgId, clamp(previous)),
    customerAttached(orgId, clamp(current)),
    customerAttached(orgId, clamp(previous)),
    recipeCoverage(orgId, now, top),
    // Not clamped: a physical stock count is a fact about inventory hygiene, not an order trend.
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

export async function getReadiness(orgId: string, now: Date = new Date(), includePreLaunch = false): Promise<Readiness> {
  return buildReadiness(await getReadinessRaw(orgId, now, includePreLaunch));
}
