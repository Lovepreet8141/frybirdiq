import "server-only";

/**
 * IQ daily facts — IQ-1 slice S6. hive/reviews/iq-1/DESIGN.md "Tables",
 * "Catalog rules"; REVIEW.md B1, B2, F1–F8.
 *
 * `recomputeDay` rebuilds one org's facts for one IST business day from the
 * transactional tables, and `readDailyFacts` sums them back over a date
 * range. Every stored metric the v1 catalog computes (`V1_COMPUTED_METRIC_IDS`)
 * is written for every day, as zero when nothing happened, so a reader can
 * tell a quiet day from a day nobody computed.
 *
 * Sales read the same sale set as the P&L (`saleSetWhere` in ./analytics),
 * so Σ facts over a range equals `getProfitAndLoss` for that range. Refunds
 * stay on today's definition (refunds.created_at, every row) until the refund
 * release adds a status and finalized_at.
 *
 * Location: sales, movements and waste carry their row's location; expenses
 * are org-level (location null). Readers sum across locations.
 *
 * No job wiring here (S8). Callers: the fact job, and the parity suite.
 */

import { and, eq, gte, inArray, lt, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  expenseCategories,
  expenses,
  iqDailyFacts,
  inventoryMovements,
  locations,
  orderItems,
  orders,
  payments,
  refunds,
  wasteEntries,
} from "@/db/schema";
import {
  DEFINITION_VERSION,
  FEES_DIMENSION_VALUE,
  METRIC_CATALOG,
  type MetricDimension,
  type MetricId,
  V1_COMPUTED_METRIC_IDS,
  productDimensionValue,
} from "@/lib/iq/metrics";
import { type DateRange, addDays, businessDate, endOfBusinessDay, startOfBusinessDay } from "@/lib/dates";
import { saleSetWhere } from "./analytics";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** A real "YYYY-MM-DD" IST business date, or a RangeError. */
function assertBusinessDate(date: string): void {
  if (!ISO_DATE.test(date) || businessDate(startOfBusinessDay(date)) !== date) {
    throw new RangeError(`iq-facts: "${date}" is not a business date`);
  }
}

/** Payment statuses that were captured at some point (F8): the captured_amount set. */
const EVER_CAPTURED = ["CAPTURED", "PARTIALLY_REFUNDED", "REFUNDED"] as const;

export interface FactRow {
  readonly locationId: string | null;
  readonly metricId: MetricId;
  readonly dimensionKey: MetricDimension | "";
  readonly dimensionValue: string;
  readonly value: bigint;
  readonly sourceRowCount: number;
}

/** Postgres sums come back as text; counts as int. */
const big = (value: string | number | bigint | null | undefined): bigint => BigInt(value ?? 0);

/** Accumulates rows keyed by (location, metric, dimension). */
class FactSet {
  private readonly rows = new Map<string, FactRow>();

  add(row: FactRow): void {
    const key = `${row.locationId ?? ""}|${row.metricId}|${row.dimensionKey}|${row.dimensionValue}`;
    const found = this.rows.get(key);
    this.rows.set(
      key,
      found ? { ...found, value: found.value + row.value, sourceRowCount: found.sourceRowCount + row.sourceRowCount } : row,
    );
  }

  /** A metric's undimensioned total plus, when `dimension` is given, its breakdown row. */
  addWithTotal(locationId: string | null, metricId: MetricId, value: bigint, sourceRowCount: number, dimension?: { key: MetricDimension; value: string }): void {
    this.add({ locationId, metricId, dimensionKey: "", dimensionValue: "", value, sourceRowCount });
    if (dimension) this.add({ locationId, metricId, dimensionKey: dimension.key, dimensionValue: dimension.value, value, sourceRowCount });
  }

  /** Zero totals, so every computed metric has a row for the day at each location. */
  ensureTotals(locationId: string | null, metricIds: readonly MetricId[]): void {
    for (const metricId of metricIds) this.add({ locationId, metricId, dimensionKey: "", dimensionValue: "", value: 0n, sourceRowCount: 0 });
  }

  total(locationId: string | null, metricId: MetricId): bigint {
    return this.rows.get(`${locationId ?? ""}|${metricId}||`)?.value ?? 0n;
  }

  list(): FactRow[] {
    return [...this.rows.values()];
  }
}

const SALE_METRICS: readonly MetricId[] = [
  "orders_paid",
  "revenue_net",
  "revenue_net_by_product",
  "units_sold",
  "gst_output",
  "sales_gross",
  "discount_total",
  "orders_comp",
  "orders_cancelled",
  "orders_failed",
  "orders_refunded",
  "orders_part_refunded",
  "refunds_amount",
  "captured_amount",
  "food_cost_theoretical",
  "food_cost_actual",
  "waste_cost",
  "sale_lines_costed",
  "sale_lines_total",
];
const ORG_METRICS: readonly MetricId[] = ["expense_direct", "expense_operating", "expense_nonoperating"];

/**
 * Computes one org's facts for one IST business day. Pure reads; `tx` is the
 * connection or transaction to read through. Exported for tests.
 */
export async function computeDayFacts(orgId: string, date: string, tx: Pick<ReturnType<typeof db>, "select"> = db()): Promise<FactRow[]> {
  assertBusinessDate(date);
  const day = { from: startOfBusinessDay(date), to: endOfBusinessDay(date) };
  const facts = new FactSet();

  const [orgLocations, sales, statuses, lines, refundRows, captured, expenseRows, movements, waste] = await Promise.all([
    tx.select({ id: locations.id }).from(locations).where(eq(locations.orgId, orgId)),

    tx
      .select({
        locationId: orders.locationId,
        channel: orders.channel,
        count: sql<number>`count(*)::int`,
        taxable: sql<string>`coalesce(sum(${orders.taxableTotal}), 0)::text`,
        tax: sql<string>`coalesce(sum(${orders.taxTotal}), 0)::text`,
        gross: sql<string>`coalesce(sum(${orders.grandTotal}), 0)::text`,
        discount: sql<string>`coalesce(sum(${orders.discountTotal}), 0)::text`,
        comp: sql<number>`(count(*) filter (where ${orders.taxableTotal} = 0))::int`,
      })
      .from(orders)
      .where(saleSetWhere(orgId, day))
      .groupBy(orders.locationId, orders.channel),

    tx
      .select({
        locationId: orders.locationId,
        channel: orders.channel,
        cancelled: sql<number>`(count(*) filter (where ${orders.status} = 'CANCELLED'))::int`,
        failed: sql<number>`(count(*) filter (where ${orders.status} = 'FAILED'))::int`,
        refunded: sql<number>`(count(*) filter (where exists (select 1 from payments pr where pr.order_id = "orders"."id" and pr.status = 'REFUNDED')))::int`,
        partRefunded: sql<number>`(count(*) filter (where exists (select 1 from payments pr where pr.order_id = "orders"."id" and pr.status = 'PARTIALLY_REFUNDED')))::int`,
      })
      .from(orders)
      .where(and(eq(orders.orgId, orgId), gte(orders.createdAt, day.from), lt(orders.createdAt, day.to)))
      .groupBy(orders.locationId, orders.channel),

    tx
      .select({
        locationId: orders.locationId,
        productId: orderItems.productId,
        count: sql<number>`count(*)::int`,
        taxable: sql<string>`coalesce(sum(${orderItems.lineTaxable}), 0)::text`,
        quantity: sql<string>`coalesce(sum(${orderItems.quantity}), 0)::text`,
      })
      .from(orderItems)
      .innerJoin(orders, eq(orders.id, orderItems.orderId))
      .where(and(saleSetWhere(orgId, day), eq(orderItems.orgId, orgId)))
      .groupBy(orders.locationId, orderItems.productId),

    tx
      .select({ locationId: orders.locationId, count: sql<number>`count(*)::int`, amount: sql<string>`coalesce(sum(${refunds.amount}), 0)::text` })
      .from(refunds)
      .innerJoin(orders, eq(orders.id, refunds.orderId))
      .where(and(eq(refunds.orgId, orgId), eq(orders.orgId, orgId), gte(refunds.createdAt, day.from), lt(refunds.createdAt, day.to)))
      .groupBy(orders.locationId),

    tx
      .select({ locationId: orders.locationId, count: sql<number>`count(*)::int`, amount: sql<string>`coalesce(sum(${payments.amount}), 0)::text` })
      .from(payments)
      .innerJoin(orders, eq(orders.id, payments.orderId))
      .where(
        and(
          eq(payments.orgId, orgId),
          eq(orders.orgId, orgId),
          inArray(payments.status, EVER_CAPTURED),
          gte(payments.capturedAt, day.from),
          lt(payments.capturedAt, day.to),
        ),
      )
      .groupBy(orders.locationId),

    tx
      .select({
        categoryId: expenseCategories.id,
        behaviour: expenseCategories.behaviour,
        isNonOperating: expenseCategories.isNonOperating,
        count: sql<number>`count(*)::int`,
        amount: sql<string>`coalesce(sum(${expenses.amount}), 0)::text`,
      })
      .from(expenses)
      .innerJoin(expenseCategories, eq(expenseCategories.id, expenses.categoryId))
      .where(and(eq(expenses.orgId, orgId), eq(expenses.paidOn, date)))
      .groupBy(expenseCategories.id, expenseCategories.behaviour, expenseCategories.isNonOperating),

    // Parity with getFoodCostComparison (stock.ts): every movement by occurred_at.
    tx
      .select({
        locationId: inventoryMovements.locationId,
        saleCount: sql<number>`(count(*) filter (where ${inventoryMovements.type} = 'SALE'))::int`,
        saleCosted: sql<number>`(count(*) filter (where ${inventoryMovements.type} = 'SALE' and ${inventoryMovements.totalCost} > 0))::int`,
        actualCount: sql<number>`(count(*) filter (where ${inventoryMovements.type} in ('SALE', 'WASTE') or (${inventoryMovements.type} = 'ADJUSTMENT' and ${inventoryMovements.quantity} < 0)))::int`,
        theoretical: sql<string>`coalesce(sum(${inventoryMovements.totalCost}) filter (where ${inventoryMovements.type} = 'SALE'), 0)::text`,
        actual: sql<string>`coalesce(sum(${inventoryMovements.totalCost}) filter (
          where ${inventoryMovements.type} in ('SALE', 'WASTE')
             or (${inventoryMovements.type} = 'ADJUSTMENT' and ${inventoryMovements.quantity} < 0)
        ), 0)::text`,
      })
      .from(inventoryMovements)
      .where(and(eq(inventoryMovements.orgId, orgId), gte(inventoryMovements.occurredAt, day.from), lt(inventoryMovements.occurredAt, day.to)))
      .groupBy(inventoryMovements.locationId),

    tx
      .select({ locationId: wasteEntries.locationId, count: sql<number>`count(*)::int`, cost: sql<string>`coalesce(sum(${wasteEntries.cost}), 0)::text` })
      .from(wasteEntries)
      .where(and(eq(wasteEntries.orgId, orgId), gte(wasteEntries.occurredAt, day.from), lt(wasteEntries.occurredAt, day.to)))
      .groupBy(wasteEntries.locationId),
  ]);

  for (const location of orgLocations) facts.ensureTotals(location.id, SALE_METRICS);
  facts.ensureTotals(null, ORG_METRICS);

  for (const row of sales) {
    const channel = { key: "channel", value: row.channel } as const;
    facts.addWithTotal(row.locationId, "orders_paid", big(row.count), row.count, channel);
    facts.addWithTotal(row.locationId, "revenue_net", big(row.taxable), row.count, channel);
    facts.addWithTotal(row.locationId, "gst_output", big(row.tax), row.count, channel);
    facts.addWithTotal(row.locationId, "sales_gross", big(row.gross), row.count, channel);
    facts.addWithTotal(row.locationId, "discount_total", big(row.discount), row.count, channel);
    facts.addWithTotal(row.locationId, "orders_comp", big(row.comp), row.comp, channel);
  }

  for (const row of statuses) {
    const channel = { key: "channel", value: row.channel } as const;
    const counts: [MetricId, number][] = [
      ["orders_cancelled", row.cancelled],
      ["orders_failed", row.failed],
      ["orders_refunded", row.refunded],
      ["orders_part_refunded", row.partRefunded],
    ];
    for (const [metricId, count] of counts) {
      if (count > 0) facts.addWithTotal(row.locationId, metricId, big(count), count, channel);
    }
  }

  // Product rows, then a fees row per location so products sum to revenue_net (D10).
  const lineTaxableByLocation = new Map<string, bigint>();
  const lineCountByLocation = new Map<string, number>();
  for (const row of lines) {
    const product = { key: "product", value: productDimensionValue(row.productId) } as const;
    facts.addWithTotal(row.locationId, "revenue_net_by_product", big(row.taxable), row.count, product);
    facts.addWithTotal(row.locationId, "units_sold", big(row.quantity), row.count, product);
    lineTaxableByLocation.set(row.locationId, (lineTaxableByLocation.get(row.locationId) ?? 0n) + big(row.taxable));
    lineCountByLocation.set(row.locationId, (lineCountByLocation.get(row.locationId) ?? 0) + row.count);
  }
  for (const location of orgLocations) {
    const revenue = facts.total(location.id, "revenue_net");
    const fees = revenue - (lineTaxableByLocation.get(location.id) ?? 0n);
    if (fees !== 0n) facts.addWithTotal(location.id, "revenue_net_by_product", fees, 0, { key: "product", value: FEES_DIMENSION_VALUE });
  }

  for (const row of refundRows) facts.addWithTotal(row.locationId, "refunds_amount", big(row.amount), row.count);
  for (const row of captured) facts.addWithTotal(row.locationId, "captured_amount", big(row.amount), row.count);

  for (const row of expenseRows) {
    const metricId: MetricId = row.isNonOperating ? "expense_nonoperating" : row.behaviour === "DIRECT" ? "expense_direct" : "expense_operating";
    facts.addWithTotal(null, metricId, big(row.amount), row.count, { key: "expense_category", value: row.categoryId });
  }

  for (const row of movements) {
    facts.addWithTotal(row.locationId, "food_cost_theoretical", big(row.theoretical), row.saleCount);
    facts.addWithTotal(row.locationId, "food_cost_actual", big(row.actual), row.actualCount);
    facts.addWithTotal(row.locationId, "sale_lines_total", big(row.saleCount), row.saleCount);
    facts.addWithTotal(row.locationId, "sale_lines_costed", big(row.saleCosted), row.saleCosted);
  }

  for (const row of waste) facts.addWithTotal(row.locationId, "waste_cost", big(row.cost), row.count);

  const computed = new Set<MetricId>(V1_COMPUTED_METRIC_IDS);
  return facts.list().filter((row) => computed.has(row.metricId));
}

export interface RecomputeResult {
  readonly orgId: string;
  readonly businessDate: string;
  readonly definitionVersion: number;
  readonly rowsWritten: number;
}

/** unique_violation or serialization_failure: a concurrent recompute of the same day committed first. */
function isRetryable(error: unknown): boolean {
  const e = error as { code?: string; cause?: { code?: string } };
  const code = e.cause?.code ?? e.code;
  return code === "23505" || code === "40001";
}

const MAX_ATTEMPTS = 3;

/**
 * Rebuilds one org's facts for one IST business day, idempotently (B2).
 *
 * One REPEATABLE READ transaction, so every metric reads the same snapshot;
 * a 64-bit advisory lock on (org, date) serialises recomputes of the same
 * day; delete then insert for (org, date, version), so a category or product
 * that no longer has rows loses its old fact row too. The lock is the first
 * statement, so a recompute that committed while this one waited is outside
 * its snapshot: its rows then collide on the unique key and the whole
 * recompute retries on a fresh snapshot.
 */
export async function recomputeDay(orgId: string, date: string, opts: { readonly jobRunId?: string | null } = {}): Promise<RecomputeResult> {
  assertBusinessDate(date);
  for (let attempt = 1; ; attempt++) {
    try {
      return await db().transaction(
        async (tx) => {
          await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`iq_daily_facts:${orgId}:${date}`}, 0))`);
          const rows = await computeDayFacts(orgId, date, tx);
          await tx
            .delete(iqDailyFacts)
            .where(and(eq(iqDailyFacts.orgId, orgId), eq(iqDailyFacts.businessDate, date), eq(iqDailyFacts.definitionVersion, DEFINITION_VERSION)));
          if (rows.length > 0) {
            await tx.insert(iqDailyFacts).values(
              rows.map((row) => ({
                orgId,
                locationId: row.locationId,
                businessDate: date,
                metricId: row.metricId,
                dimensionKey: row.dimensionKey,
                dimensionValue: row.dimensionValue,
                unit: METRIC_CATALOG[row.metricId].unit,
                value: row.value,
                sourceRowCount: row.sourceRowCount,
                // Not updated_at: nothing maintains it (REVIEW required change 2). Freshness is the job's recompute policy.
                sourceWatermark: null,
                definitionVersion: DEFINITION_VERSION,
                jobRunId: opts.jobRunId ?? null,
              })),
            );
          }
          return { orgId, businessDate: date, definitionVersion: DEFINITION_VERSION, rowsWritten: rows.length };
        },
        { isolationLevel: "repeatable read" },
      );
    } catch (error) {
      if (!isRetryable(error) || attempt >= MAX_ATTEMPTS) throw error;
    }
  }
}

export interface DailyFactsRead {
  /** First and last IST business date read, inclusive. */
  readonly from: string;
  readonly to: string;
  /** Dates in the range with computed facts, and those without. A missing day is unknown, never zero. */
  readonly computedDates: readonly string[];
  readonly missingDates: readonly string[];
  /** Σ undimensioned value per metric across days and locations. Absent metric = no rows. */
  readonly totals: Readonly<Partial<Record<MetricId, bigint>>>;
  /** Σ value per metric, dimension key and dimension value. */
  readonly breakdowns: Readonly<Partial<Record<MetricId, Readonly<Record<string, Readonly<Record<string, bigint>>>>>>>;
}

function datesBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

/** The inclusive IST business dates a whole-day range covers. */
export function businessDatesOf(range: Pick<DateRange, "from" | "to">): { from: string; to: string } {
  return { from: businessDate(range.from), to: businessDate(new Date(range.to.getTime() - 1)) };
}

/**
 * Sums an org's current-version daily facts over [from, to] (IST dates,
 * inclusive), across locations. Derived figures (profit, AOV, margins) are
 * computed by the caller from these sums with `src/lib/iq/metrics/derive`.
 */
export async function readDailyFacts(orgId: string, from: string, to: string): Promise<DailyFactsRead> {
  assertBusinessDate(from);
  assertBusinessDate(to);
  if (from > to) throw new RangeError(`iq-facts: range starts ${from} after it ends ${to}`);

  const inRange = and(
    eq(iqDailyFacts.orgId, orgId),
    eq(iqDailyFacts.definitionVersion, DEFINITION_VERSION),
    gte(iqDailyFacts.businessDate, from),
    lte(iqDailyFacts.businessDate, to),
  );

  const [sums, dates] = await Promise.all([
    db()
      .select({
        metricId: iqDailyFacts.metricId,
        dimensionKey: iqDailyFacts.dimensionKey,
        dimensionValue: iqDailyFacts.dimensionValue,
        value: sql<string>`sum(${iqDailyFacts.value})::text`,
      })
      .from(iqDailyFacts)
      .where(inRange)
      .groupBy(iqDailyFacts.metricId, iqDailyFacts.dimensionKey, iqDailyFacts.dimensionValue),
    db()
      .selectDistinct({ date: iqDailyFacts.businessDate })
      .from(iqDailyFacts)
      .where(and(inRange, eq(iqDailyFacts.metricId, "orders_paid"), eq(iqDailyFacts.dimensionKey, ""))),
  ]);

  const totals: Partial<Record<MetricId, bigint>> = {};
  const breakdowns: Partial<Record<MetricId, Record<string, Record<string, bigint>>>> = {};
  for (const row of sums) {
    const metricId = row.metricId as MetricId;
    const value = BigInt(row.value);
    if (row.dimensionKey === "") {
      totals[metricId] = value;
    } else {
      const byKey = (breakdowns[metricId] ??= {});
      (byKey[row.dimensionKey] ??= {})[row.dimensionValue] = value;
    }
  }

  const computed = new Set(dates.map((row) => row.date));
  const all = datesBetween(from, to);
  return {
    from,
    to,
    computedDates: all.filter((d) => computed.has(d)),
    missingDates: all.filter((d) => !computed.has(d)),
    totals,
    breakdowns,
  };
}
