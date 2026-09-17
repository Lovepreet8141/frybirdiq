import "server-only";

/**
 * IQ daily trust — IQ-1 slice S7. hive/reviews/iq-1/DESIGN.md "Trust
 * signals"; REVIEW.md required change 3 and I2.
 *
 * `computeTrustDay` counts, for one org and one IST business day, what each
 * signal T1–T7 measures, grades it with the pure scorers in
 * `src/lib/iq/trust`, and writes one `iq_daily_trust` row per signal.
 * `getMetricTrust` reads them back for a metric over a date range: the
 * lowest grade among its signals and days, naming the limiting signal.
 *
 * Detail holds counts only — never a name, phone, id or amount tied to a
 * person. Org-level in v1 (location null). No job wiring here (S8).
 */

import { and, eq, gte, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import { iqDailyTrust, organizations } from "@/db/schema";
import { BUSINESS_TIMEZONE, addDays, businessDate, startOfBusinessDay, endOfBusinessDay } from "@/lib/dates";
import { type AnyMetricId, TRUST_SIGNAL_IDS, type TrustSignalId, businessDateSql } from "@/lib/iq/metrics";
import {
  CLOCK_SKEW_LIMIT_MS,
  type MetricTrust,
  MIDNIGHT_TOLERANCE_MS,
  PLACED_DRIFT_LIMIT_MS,
  PRICE_FRESHNESS_DAYS,
  type SignalScore,
  type TrustGrade,
  WASTE_WINDOW_DAYS,
  gradeClockSanity,
  gradeCostRecording,
  gradeCostedSaleRows,
  gradePaymentIntegrity,
  gradePriceFreshness,
  gradeRank,
  gradeRecipeCoverage,
  gradeStockCountRecency,
  gradeWasteLogging,
  metricTrust,
} from "@/lib/iq/trust";
import { hasPaidPayment } from "./analytics";
import { type DayLockOptions, assertBusinessDate, runLockedDayTransaction } from "./iq-facts";

/** Version of the trust definitions written beside `iq_daily_trust` rows. */
export const TRUST_DEFINITION_VERSION = 1;

type Reader = Pick<ReturnType<typeof db>, "execute">;

const n = (value: unknown): bigint => BigInt((value as string | number | null | undefined) ?? 0);
const int = (value: unknown): number => Number(value ?? 0);

async function one(tx: Reader, query: ReturnType<typeof sql>): Promise<Record<string, unknown>> {
  const rows = await tx.execute<Record<string, unknown>>(query);
  return rows[0] ?? {};
}

export interface TrustDayOptions extends DayLockOptions {
  readonly jobRunId?: string | null;
  /**
   * The app's clock. Decides whether the date is today (IST), and is compared
   * with the database clock for T5 — on today only. Defaults to now.
   */
  readonly appNow?: Date;
}

/** Scores every signal for one org and day. Reads only; exported for tests. */
export async function scoreTrustDay(orgId: string, date: string, tx: Reader = db(), opts: TrustDayOptions = {}): Promise<SignalScore[]> {
  assertBusinessDate(date);
  const from = startOfBusinessDay(date).toISOString();
  const to = endOfBusinessDay(date).toISOString();
  const saleSet = sql`o.org_id = ${orgId} AND o.created_at >= ${from} AND o.created_at < ${to}
    AND o.status NOT IN ('CANCELLED', 'FAILED', 'REFUNDED') AND ${hasPaidPayment(sql`o.id`)}`;

  // T1: net line value of sold lines whose product has a current recipe with
  // at least one item and every item's ingredient priced.
  const t1 = await one(
    tx,
    sql`SELECT coalesce(sum(oi.line_taxable), 0)::text AS total,
          coalesce(sum(oi.line_taxable) FILTER (WHERE covered), 0)::text AS covered,
          count(*)::int AS lines, (count(*) FILTER (WHERE covered))::int AS covered_lines
        FROM (
          SELECT oi.line_taxable,
            EXISTS (SELECT 1 FROM recipes r JOIN recipe_version_items rvi ON rvi.version_id = r.current_version_id
                    WHERE r.org_id = ${orgId} AND r.product_id = oi.product_id)
            AND NOT EXISTS (SELECT 1 FROM recipes r JOIN recipe_version_items rvi ON rvi.version_id = r.current_version_id
                    JOIN ingredients i ON i.id = rvi.ingredient_id
                    WHERE r.org_id = ${orgId} AND r.product_id = oi.product_id AND coalesce(i.cost_per_base_unit_milli, 0) <= 0) AS covered
          FROM order_items oi JOIN orders o ON o.id = oi.order_id
          WHERE oi.org_id = ${orgId} AND ${saleSet}
        ) oi`,
  );
  const t1Total = n(t1.total) > 0n ? n(t1.total) : 0n;
  const t1Raw = n(t1.covered);
  const t1Covered = t1Total === 0n ? 0n : t1Raw < 0n ? 0n : t1Raw > t1Total ? t1Total : t1Raw;
  if (t1Total > 0n && t1Covered !== t1Raw) {
    console.warn(`iq-trust: T1 covered ${t1Raw} outside 0..${t1Total} for org ${orgId} on ${date}; clamped (negative line_taxable?)`);
  } else if (t1Total === 0n && n(t1.total) < 0n) {
    console.warn(`iq-trust: T1 total line value ${n(t1.total)} is negative for org ${orgId} on ${date}; scored as nothing measured`);
  }

  // T1b and T2: SALE movements on the day.
  const moves = await one(
    tx,
    sql`SELECT count(*)::int AS total,
          (count(*) FILTER (WHERE m.total_cost > 0))::int AS costed,
          coalesce(sum(m.total_cost), 0)::text AS weight,
          coalesce(sum(m.total_cost) FILTER (WHERE fresh), 0)::text AS fresh_weight,
          (count(*) FILTER (WHERE fresh))::int AS fresh_rows
        FROM (
          SELECT m.total_cost,
            EXISTS (SELECT 1 FROM ingredient_prices ip
                    WHERE ip.org_id = ${orgId} AND ip.ingredient_id = m.ingredient_id
                      AND ip.effective_from < ${to}
                      AND ip.effective_from >= ${to}::timestamptz - make_interval(days => ${PRICE_FRESHNESS_DAYS})) AS fresh
          FROM inventory_movements m
          WHERE m.org_id = ${orgId} AND m.type = 'SALE' AND m.occurred_at >= ${from} AND m.occurred_at < ${to}
        ) m`,
  );

  // T4: sales days and waste-logged days in the 7 IST days ending on the date.
  const windowFrom = startOfBusinessDay(addDays(date, -(WASTE_WINDOW_DAYS - 1))).toISOString();
  const orderDay = sql.raw(businessDateSql("o.created_at"));
  const wasteDay = sql.raw(businessDateSql("w.occurred_at"));
  const t4 = await one(
    tx,
    sql`WITH sales AS (
          SELECT DISTINCT ${orderDay} AS day FROM orders o
          WHERE o.org_id = ${orgId} AND o.created_at >= ${windowFrom} AND o.created_at < ${to}
            AND o.status NOT IN ('CANCELLED', 'FAILED', 'REFUNDED') AND ${hasPaidPayment(sql`o.id`)}
        ), waste AS (
          SELECT DISTINCT ${wasteDay} AS day FROM waste_entries w
          WHERE w.org_id = ${orgId} AND w.occurred_at >= ${windowFrom} AND w.occurred_at < ${to}
        )
        SELECT (SELECT count(*) FROM sales)::int AS sales_days,
               (SELECT count(*) FROM sales JOIN waste USING (day))::int AS logged_days,
               (SELECT count(*) FROM waste)::int AS waste_days`,
  );

  // T5: rows anchored on the day, and org-level clock and timezone checks.
  // business_date is the app clock before the insert, created_at the DB clock
  // at the insert, so an order whose request spans IST midnight can differ by
  // a day honestly. Count a mismatch only beyond MIDNIGHT_TOLERANCE_MS of it.
  const createdDayStart = `((o.created_at AT TIME ZONE '${BUSINESS_TIMEZONE}')::date::timestamp AT TIME ZONE '${BUSINESS_TIMEZONE}')`;
  const businessDateMismatch = sql`(o.business_date <> ${sql.raw(businessDateSql("o.created_at"))}
    AND least(extract(epoch FROM o.created_at - ${sql.raw(createdDayStart)}),
              extract(epoch FROM ${sql.raw(createdDayStart)} + interval '1 day' - o.created_at)) * 1000 > ${MIDNIGHT_TOLERANCE_MS})`;
  const appNow = opts.appNow ?? new Date();
  // Clock skew and the timezone setting describe the system now, so they are
  // stamped only on today's row; a historical recompute never inherits them.
  const scoringToday = businessDate(appNow) === date;
  const t5 = await one(
    tx,
    sql`SELECT
          (SELECT count(*) FROM orders o WHERE o.org_id = ${orgId} AND o.created_at >= ${from} AND o.created_at < ${to})::int AS orders,
          (SELECT count(*) FROM orders o WHERE o.org_id = ${orgId} AND o.created_at >= ${from} AND o.created_at < ${to}
             AND (${businessDateMismatch}
                  OR (o.placed_at IS NOT NULL AND abs(extract(epoch FROM o.placed_at - o.created_at)) * 1000 > ${PLACED_DRIFT_LIMIT_MS})
                  OR o.created_at > clock_timestamp()))::int AS bad_orders,
          (SELECT count(*) FROM orders o WHERE o.org_id = ${orgId} AND o.created_at >= ${from} AND o.created_at < ${to}
             AND ${businessDateMismatch})::int AS business_date_mismatch,
          (SELECT count(*) FROM orders o WHERE o.org_id = ${orgId} AND o.created_at >= ${from} AND o.created_at < ${to}
             AND o.placed_at IS NOT NULL AND abs(extract(epoch FROM o.placed_at - o.created_at)) * 1000 > ${PLACED_DRIFT_LIMIT_MS})::int AS placed_drift,
          (SELECT count(*) FROM inventory_movements m WHERE m.org_id = ${orgId} AND m.occurred_at >= ${from} AND m.occurred_at < ${to})::int AS movements,
          ((SELECT count(*) FROM orders o WHERE o.org_id = ${orgId} AND o.created_at >= ${from} AND o.created_at < ${to} AND o.created_at > clock_timestamp())
           + (SELECT count(*) FROM inventory_movements m WHERE m.org_id = ${orgId} AND m.occurred_at >= ${from} AND m.occurred_at < ${to} AND m.occurred_at > clock_timestamp()))::int AS future_rows,
          (SELECT count(*) FROM inventory_movements m WHERE m.org_id = ${orgId} AND m.occurred_at >= ${from} AND m.occurred_at < ${to} AND m.occurred_at > clock_timestamp())::int AS future_movements,
          (SELECT o.timezone FROM ${organizations} o WHERE o.id = ${orgId}) AS timezone,
          (extract(epoch FROM clock_timestamp()) * 1000)::bigint::text AS db_now_ms`,
  );
  const clockSkewMs = scoringToday ? Math.abs(Number(t5.db_now_ms) - appNow.getTime()) : 0;
  const timezoneMismatch = scoringToday && t5.timezone !== BUSINESS_TIMEZONE;
  const t5Checked = BigInt(int(t5.orders) + int(t5.movements));
  const t5Clean = t5Checked - BigInt(int(t5.bad_orders) + int(t5.future_movements));
  const orgChecksPass = !timezoneMismatch && clockSkewMs <= CLOCK_SKEW_LIMIT_MS;

  // T6: orders on the day that carry at least one payment.
  const t6 = await one(
    tx,
    sql`SELECT count(*)::int AS checked,
          (count(*) FILTER (WHERE captured_n > 1))::int AS multi_captured,
          (count(*) FILTER (WHERE partial))::int AS partially_refunded,
          (count(*) FILTER (WHERE cancelled_no_refund))::int AS cancelled_captured_no_refund,
          (count(*) FILTER (WHERE failed_captured))::int AS failed_with_capture,
          (count(*) FILTER (WHERE mismatch))::int AS captured_not_grand_total,
          (count(*) FILTER (WHERE captured_n > 1 OR partial OR cancelled_no_refund OR failed_captured OR mismatch))::int AS anomalous
        FROM (
          SELECT
            (SELECT count(*) FROM payments p WHERE p.order_id = o.id AND p.status = 'CAPTURED') AS captured_n,
            EXISTS (SELECT 1 FROM payments p WHERE p.order_id = o.id AND p.status = 'PARTIALLY_REFUNDED') AS partial,
            (o.status = 'CANCELLED'
              AND EXISTS (SELECT 1 FROM payments p WHERE p.order_id = o.id AND p.status IN ('CAPTURED', 'PARTIALLY_REFUNDED'))
              -- TODO(ref-1): SUCCEEDED refunds only, once refunds carry a status.
              AND NOT EXISTS (SELECT 1 FROM refunds r WHERE r.order_id = o.id)) AS cancelled_no_refund,
            (o.status = 'FAILED'
              AND EXISTS (SELECT 1 FROM payments p WHERE p.order_id = o.id AND p.status IN ('CAPTURED', 'PARTIALLY_REFUNDED'))) AS failed_captured,
            (o.status NOT IN ('CANCELLED', 'FAILED', 'REFUNDED')
              AND EXISTS (SELECT 1 FROM payments p WHERE p.order_id = o.id AND p.status IN ('CAPTURED', 'PARTIALLY_REFUNDED', 'REFUNDED'))
              AND (SELECT coalesce(sum(p.amount), 0) FROM payments p WHERE p.order_id = o.id AND p.status IN ('CAPTURED', 'PARTIALLY_REFUNDED', 'REFUNDED')) <> o.grand_total) AS mismatch
          FROM orders o
          WHERE o.org_id = ${orgId} AND o.created_at >= ${from} AND o.created_at < ${to}
            AND EXISTS (SELECT 1 FROM payments p WHERE p.order_id = o.id)
        ) x`,
  );

  // T7: DIRECT operating expenses in the IST month so far and in the last 7 days.
  const monthFrom = `${date.slice(0, 7)}-01`;
  const weekFrom = addDays(date, -6);
  const t7 = await one(
    tx,
    sql`SELECT (count(*) FILTER (WHERE e.paid_on >= ${monthFrom}))::int AS month_expenses,
               (count(*) FILTER (WHERE e.paid_on >= ${weekFrom}))::int AS week_expenses
        FROM expenses e JOIN expense_categories c ON c.id = e.category_id
        WHERE e.org_id = ${orgId} AND c.behaviour = 'DIRECT' AND NOT c.is_non_operating
          AND e.paid_on >= least(${monthFrom}::date, ${weekFrom}::date) AND e.paid_on <= ${date}`,
  );
  const inMonth = int(t7.month_expenses) > 0;
  const inWeek = int(t7.week_expenses) > 0;

  const t4Sales = BigInt(int(t4.sales_days));
  const t4Logged = BigInt(int(t4.logged_days));
  const t6Checked = BigInt(int(t6.checked));
  const t6Clean = t6Checked - BigInt(int(t6.anomalous));
  const saleRows = BigInt(int(moves.total));
  const costedRows = BigInt(int(moves.costed));
  const weight = n(moves.weight);
  const freshWeight = n(moves.fresh_weight);

  const scores: SignalScore[] = [
    {
      signalId: "t1_recipe_coverage",
      numerator: t1Covered,
      denominator: t1Total,
      grade: gradeRecipeCoverage(t1Covered, t1Total),
      detail: { lines: int(t1.lines), covered_lines: int(t1.covered_lines) },
    },
    {
      signalId: "t1b_costed_sale_rows",
      numerator: costedRows,
      denominator: saleRows,
      grade: gradeCostedSaleRows(costedRows, saleRows),
      detail: { sale_movements: int(moves.total), costed_sale_movements: int(moves.costed) },
    },
    {
      signalId: "t2_price_freshness",
      numerator: freshWeight,
      denominator: weight,
      grade: gradePriceFreshness(freshWeight, weight),
      detail: { sale_movements: int(moves.total), fresh_sale_movements: int(moves.fresh_rows), freshness_days: PRICE_FRESHNESS_DAYS },
    },
    { signalId: "t3_stock_count_recency", numerator: 0n, denominator: 0n, grade: gradeStockCountRecency(), detail: {} },
    {
      signalId: "t4_waste_logging",
      numerator: t4Logged,
      denominator: t4Sales,
      grade: gradeWasteLogging(t4Logged, t4Sales),
      detail: { sales_days: int(t4.sales_days), logged_sales_days: int(t4.logged_days), waste_days: int(t4.waste_days), window_days: WASTE_WINDOW_DAYS },
    },
    {
      signalId: "t5_clock_sanity",
      numerator: t5Clean,
      denominator: t5Checked,
      grade: gradeClockSanity(t5Clean, t5Checked, orgChecksPass),
      detail: {
        orders_checked: int(t5.orders),
        movements_checked: int(t5.movements),
        business_date_mismatch: int(t5.business_date_mismatch),
        placed_drift: int(t5.placed_drift),
        future_rows: int(t5.future_rows),
        org_checks_applied: scoringToday ? 1 : 0,
        timezone_mismatch: timezoneMismatch ? 1 : 0,
        clock_skew_ms: clockSkewMs,
      },
    },
    {
      signalId: "t6_payment_integrity",
      numerator: t6Clean,
      denominator: t6Checked,
      grade: gradePaymentIntegrity(t6Clean, t6Checked),
      detail: {
        orders_checked: int(t6.checked),
        multi_captured: int(t6.multi_captured),
        partially_refunded: int(t6.partially_refunded),
        cancelled_captured_no_refund: int(t6.cancelled_captured_no_refund),
        failed_with_capture: int(t6.failed_with_capture),
        captured_not_grand_total: int(t6.captured_not_grand_total),
      },
    },
    {
      signalId: "t7_cost_recording",
      numerator: BigInt((inMonth ? 1 : 0) + (inWeek ? 1 : 0)),
      denominator: 2n,
      grade: gradeCostRecording(inMonth, inWeek),
      detail: { month_direct_expenses: int(t7.month_expenses), week_direct_expenses: int(t7.week_expenses) },
    },
  ];
  return scores;
}

/** The advisory lock key text for one org's trust day. */
export function trustDayLockKey(orgId: string, date: string): string {
  return `iq_daily_trust:${orgId}:${date}`;
}

export interface TrustDayResult {
  readonly orgId: string;
  readonly businessDate: string;
  readonly definitionVersion: number;
  readonly scores: readonly SignalScore[];
  readonly lockWaits: number;
  readonly attempts: number;
}

/**
 * Scores and stores one org's trust for one IST business day, idempotently:
 * the same locked REPEATABLE READ transaction as `recomputeDay`, delete then
 * insert for (org, date, version).
 */
export async function computeTrustDay(orgId: string, date: string, opts: TrustDayOptions = {}): Promise<TrustDayResult> {
  assertBusinessDate(date);
  const { value: scores, lockWaits, attempts } = await runLockedDayTransaction(trustDayLockKey(orgId, date), `iq-trust: ${date} for org ${orgId}`, async (tx) => {
    const scored = await scoreTrustDay(orgId, date, tx, opts);
    await tx
      .delete(iqDailyTrust)
      .where(and(eq(iqDailyTrust.orgId, orgId), eq(iqDailyTrust.businessDate, date), eq(iqDailyTrust.definitionVersion, TRUST_DEFINITION_VERSION)));
    await tx.insert(iqDailyTrust).values(
      scored.map((score) => ({
        orgId,
        locationId: null,
        businessDate: date,
        signalId: score.signalId,
        numerator: score.numerator,
        denominator: score.denominator,
        grade: score.grade,
        detail: score.detail,
        definitionVersion: TRUST_DEFINITION_VERSION,
        jobRunId: opts.jobRunId ?? null,
      })),
    );
    return scored;
  }, opts);
  return { orgId, businessDate: date, definitionVersion: TRUST_DEFINITION_VERSION, scores, lockWaits, attempts };
}

export interface MetricTrustRead extends MetricTrust {
  /** The business date the limiting signal's grade comes from; null when nothing limits or the day was never scored. */
  readonly limitingDate: string | null;
  /** Days in the range with no trust rows. Each counts as UNKNOWN for every signal. */
  readonly missingDates: readonly string[];
}

/**
 * A metric's trust over [from, to] (IST dates, inclusive): each signal's worst
 * grade across the days (a day never scored is UNKNOWN), then the lowest
 * across the metric's signals, naming the limiting signal and its day.
 */
export async function getMetricTrust(orgId: string, metricId: AnyMetricId, from: string, to: string): Promise<MetricTrustRead> {
  assertBusinessDate(from);
  assertBusinessDate(to);
  if (from > to) throw new RangeError(`iq-trust: range starts ${from} after it ends ${to}`);

  const rows = await db()
    .select({ date: iqDailyTrust.businessDate, signalId: iqDailyTrust.signalId, grade: iqDailyTrust.grade })
    .from(iqDailyTrust)
    .where(
      and(
        eq(iqDailyTrust.orgId, orgId),
        eq(iqDailyTrust.definitionVersion, TRUST_DEFINITION_VERSION),
        gte(iqDailyTrust.businessDate, from),
        lte(iqDailyTrust.businessDate, to),
      ),
    );

  const dates: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) dates.push(d);
  const scored = new Set(rows.map((row) => row.date));
  const missingDates = dates.filter((d) => !scored.has(d));

  const worst: Partial<Record<TrustSignalId, { grade: TrustGrade; date: string }>> = {};
  const consider = (signalId: TrustSignalId, grade: TrustGrade, date: string) => {
    const current = worst[signalId];
    if (!current || gradeRank(grade) < gradeRank(current.grade)) worst[signalId] = { grade, date };
  };
  for (const row of rows) {
    if ((TRUST_SIGNAL_IDS as readonly string[]).includes(row.signalId)) consider(row.signalId as TrustSignalId, row.grade as TrustGrade, row.date);
  }
  for (const date of missingDates) for (const signalId of TRUST_SIGNAL_IDS) consider(signalId, "UNKNOWN", date);

  const grades = Object.fromEntries(Object.entries(worst).map(([signalId, value]) => [signalId, value.grade])) as Partial<Record<TrustSignalId, TrustGrade>>;
  const trust = metricTrust(metricId, grades);
  return { ...trust, limitingDate: trust.limitingSignal ? (worst[trust.limitingSignal]?.date ?? null) : null, missingDates };
}
