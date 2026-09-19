import "server-only";

/**
 * IQ-2 S4 — what the reconciliation rules read. SELECT only.
 *
 * hive/reviews/iq-2/DESIGN.md R2.5: each rule reads in one REPEATABLE READ,
 * READ ONLY transaction with statement_timeout 10 s — the database refuses
 * any write inside it (SQLSTATE 25006) — takes no row or advisory locks, and
 * leaves out rows changed in the last 5 minutes (a live request may still be
 * writing them). Every query filters org_id itself: the app connects as
 * `postgres`, which bypasses RLS.
 *
 * Money stays bigint end to end: SQL sums come back as text and become
 * `paise(BigInt(text))`; the checks themselves are pure
 * (`src/lib/iq/reconcile/rules.ts`). Days are the IST business day of the
 * order's created_at, the same anchor as the sale set and the daily facts.
 *
 * Refunds: only a refund that landed is money back — `COUNTED_REFUND`,
 * SUCCEEDED (migration 0038, where SUCCEEDED ⇔ finalized_at is a check
 * constraint). One definition, used by every rule that reads a refund: a
 * RESERVED attempt in flight and a FAILED one are not refunds, and counting
 * them fires OVER_REFUNDED on a correct credit note.
 */
import { sql } from "drizzle-orm";

import { db } from "@/db";
import { organizations } from "@/db/schema";
import { endOfBusinessDay, startOfBusinessDay } from "@/lib/dates";
import type { FigureTrust, Observed } from "@/lib/iq/engine";
import { observed, observedPaise } from "@/lib/iq/engine/observed-factory";
import { DEFINITION_VERSION as FACTS_DEFINITION_VERSION, businessDateSql } from "@/lib/iq/metrics";
import type { ReconCounts, ReconRunRead } from "@/lib/iq/reconcile/reconcile-job";
import {
  type CaptureRow,
  type Dated,
  type FactsParityDay,
  type GstLine,
  type GstLinesRow,
  type InvoiceRow,
  type LoyaltyRefundRow,
  type OrderTotalsRow,
  RECON_MIN_ROW_AGE_MS,
  RECON_WINDOW_DAYS,
  type RefundPaymentRow,
  type ReconWindowRead,
  type RuleRead,
  type StatusPaymentRow,
  evaluateReconWindow,
  reconWindow,
} from "@/lib/iq/reconcile/rules";
import { financialYear } from "@/lib/invoice";
import { type Bps, paise } from "@/lib/money";
import type { PriceBasis } from "@/lib/pricing";

import { TRUST_DEFINITION_VERSION } from "./iq-trust";

/** Per-statement limit inside a rule's read (R2.5). */
export const RECON_STATEMENT_TIMEOUT_MS = 10_000;

type ReadTx = Parameters<Parameters<ReturnType<typeof db>["transaction"]>[0]>[0];

/**
 * Runs `work` in a REPEATABLE READ READ ONLY transaction with the statement
 * timeout set. A statement timeout (57014) becomes `{ status: "timeout" }`;
 * anything else is thrown. Exported so a test can prove a write is refused.
 */
export async function runReconReadOnly<T>(work: (tx: ReadTx) => Promise<readonly T[]>, timeoutMs = RECON_STATEMENT_TIMEOUT_MS): Promise<RuleRead<T>> {
  try {
    const rows = await db().transaction(
      async (tx) => {
        await tx.execute(sql.raw(`SET LOCAL statement_timeout = '${Math.max(1, Math.floor(timeoutMs))}ms'`));
        return work(tx);
      },
      { isolationLevel: "repeatable read", accessMode: "read only" },
    );
    return { status: "evaluated", rows };
  } catch (error) {
    const e = error as { code?: string; cause?: { code?: string } };
    if ((e.cause?.code ?? e.code) === "57014") return { status: "timeout" };
    throw error;
  }
}

const money = (value: unknown) => paise(BigInt(String(value ?? "0")));
const int = (value: unknown) => Number(value ?? 0);
const text = (value: unknown) => String(value);

/** Statuses of a payment that took money at some point (F8). */
const EVER_CAPTURED = sql.raw(`('CAPTURED', 'PARTIALLY_REFUNDED', 'REFUNDED')`);
/** What "paid" means for the sale set — analytics.ts PAID_PAYMENT_STATUSES, in SQL for the parity read. */
const PAID_PAYMENT = sql.raw(`('CAPTURED', 'PARTIALLY_REFUNDED')`);
/**
 * Refund rows that count as money back: the ones that landed. Every refund
 * read in this file goes through it — the refund-vs-payment sums, and the
 * gst_lines "this order was refunded" flag — so there is one answer to what a
 * refund is, not one per query. `r` is the refunds row's alias.
 */
const COUNTED_REFUND = sql.raw(`r.status = 'SUCCEEDED'`);
/** Orders that were never priced for a sale are not reconciled here (half orders are PAYMENT-SAFETY's signature). */
const PRICED_ORDER = sql.raw(`o.status NOT IN ('DRAFT', 'PENDING_PAYMENT', 'FAILED')`);

type Window = { readonly orgId: string; readonly from: Date; readonly to: Date; readonly settled: Date };

function orderWindow(w: Window) {
  return sql`o.org_id = ${w.orgId} AND o.created_at >= ${w.from.toISOString()} AND o.created_at < ${w.to.toISOString()} AND o.updated_at < ${w.settled.toISOString()}`;
}

/** No payment or refund on the order changed in the last 5 minutes. */
function settledMoney(w: Window) {
  return sql`NOT EXISTS (SELECT 1 FROM payments sp WHERE sp.order_id = o.id AND sp.org_id = ${w.orgId} AND sp.updated_at >= ${w.settled.toISOString()})
    AND NOT EXISTS (SELECT 1 FROM refunds sr WHERE sr.order_id = o.id AND sr.org_id = ${w.orgId} AND sr.updated_at >= ${w.settled.toISOString()})`;
}

const DAY = sql.raw(`${businessDateSql("o.created_at")}::text`);

async function readOrderTotals(w: Window): Promise<RuleRead<Dated<OrderTotalsRow>>> {
  return runReconReadOnly(async (tx) => {
    const rows = await tx.execute<Record<string, unknown>>(sql`
      SELECT o.id, ${DAY} AS day,
        o.subtotal::text AS subtotal, o.discount_total::text AS discount_total, o.taxable_total::text AS taxable_total,
        o.tax_total::text AS tax_total, o.cgst_total::text AS cgst_total, o.sgst_total::text AS sgst_total, o.igst_total::text AS igst_total,
        o.delivery_fee::text AS delivery_fee, o.packaging_fee::text AS packaging_fee, o.tip_amount::text AS tip_amount,
        o.grand_total::text AS grand_total, o.stamp_reward_discount::text AS stamp_reward_discount, o.points_redeemed,
        coalesce(sum(oi.line_subtotal), 0)::text AS line_subtotal_sum,
        coalesce(sum(oi.line_discount), 0)::text AS line_discount_sum,
        count(oi.id)::int AS line_count,
        (count(oi.id) FILTER (WHERE oi.line_taxable + oi.line_tax <> oi.line_subtotal - oi.line_discount))::int AS off_inclusive,
        (count(oi.id) FILTER (WHERE oi.line_taxable <> oi.line_subtotal - oi.line_discount))::int AS off_exclusive
      FROM orders o
      LEFT JOIN order_items oi ON oi.order_id = o.id AND oi.org_id = ${w.orgId}
      WHERE ${orderWindow(w)} AND ${PRICED_ORDER}
      GROUP BY o.id`);
    return rows.map((r) => ({
      day: text(r.day),
      orderId: text(r.id),
      subtotal: money(r.subtotal),
      discountTotal: money(r.discount_total),
      taxableTotal: money(r.taxable_total),
      taxTotal: money(r.tax_total),
      cgstTotal: money(r.cgst_total),
      sgstTotal: money(r.sgst_total),
      igstTotal: money(r.igst_total),
      deliveryFee: money(r.delivery_fee),
      packagingFee: money(r.packaging_fee),
      tipAmount: money(r.tip_amount),
      grandTotal: money(r.grand_total),
      stampRewardDiscount: money(r.stamp_reward_discount),
      pointsRedeemed: int(r.points_redeemed),
      lineSubtotalSum: money(r.line_subtotal_sum),
      lineDiscountSum: money(r.line_discount_sum),
      lineCount: int(r.line_count),
      linesOffInclusive: int(r.off_inclusive),
      linesOffExclusive: int(r.off_exclusive),
    }));
  });
}

async function readCaptures(w: Window): Promise<RuleRead<Dated<CaptureRow>>> {
  return runReconReadOnly(async (tx) => {
    // The sale set (analytics.ts saleSetWhere): paid, not cancelled/failed/refunded.
    const rows = await tx.execute<Record<string, unknown>>(sql`
      SELECT o.id, ${DAY} AS day, o.grand_total::text AS grand_total,
        coalesce(sum(p.amount), 0)::text AS captured_ever, count(p.id)::int AS capture_count, max(p.created_at) AS last_capture_created_at
      FROM orders o
      JOIN payments p ON p.order_id = o.id AND p.org_id = ${w.orgId} AND p.status IN ${EVER_CAPTURED}
      WHERE ${orderWindow(w)} AND ${settledMoney(w)}
        AND o.status NOT IN ('CANCELLED', 'FAILED', 'REFUNDED')
        AND EXISTS (SELECT 1 FROM payments pp WHERE pp.order_id = o.id AND pp.org_id = ${w.orgId} AND pp.status IN ('CAPTURED', 'PARTIALLY_REFUNDED'))
      GROUP BY o.id`);
    return rows.map((r) => ({
      day: text(r.day),
      orderId: text(r.id),
      grandTotal: money(r.grand_total),
      capturedEver: money(r.captured_ever),
      captureCount: int(r.capture_count),
      lastCaptureCreatedAt: new Date(String(r.last_capture_created_at)),
    }));
  });
}

async function readStatusPayments(w: Window): Promise<RuleRead<Dated<StatusPaymentRow>>> {
  return runReconReadOnly(async (tx) => {
    const rows = await tx.execute<Record<string, unknown>>(sql`
      SELECT o.id, ${DAY} AS day, o.status::text AS status, o.business_date::text AS business_date,
        EXISTS (SELECT 1 FROM payments p WHERE p.order_id = o.id AND p.org_id = ${w.orgId} AND p.status IN ${EVER_CAPTURED}) AS has_capture
      FROM orders o
      WHERE ${orderWindow(w)} AND ${settledMoney(w)}
        AND o.status IN ('PAID', 'COMPLETED', 'ACCEPTED', 'PREPARING', 'READY', 'OUT_FOR_DELIVERY')`);
    return rows.map((r) => ({ day: text(r.day), orderId: text(r.id), status: text(r.status), businessDate: text(r.business_date), hasCapture: r.has_capture === true }));
  });
}

async function readRefundPayments(w: Window): Promise<RuleRead<Dated<RefundPaymentRow>>> {
  return runReconReadOnly(async (tx) => {
    const rows = await tx.execute<Record<string, unknown>>(sql`
      SELECT p.id, ${DAY} AS day, p.status::text AS status, p.amount::text AS amount,
        (SELECT coalesce(sum(r.amount), 0) FROM refunds r WHERE r.payment_id = p.id AND r.org_id = ${w.orgId} AND ${COUNTED_REFUND})::text AS refunded
      FROM payments p
      JOIN orders o ON o.id = p.order_id AND o.org_id = ${w.orgId}
      WHERE p.org_id = ${w.orgId} AND ${orderWindow(w)} AND ${settledMoney(w)}
        AND (p.status IN ${EVER_CAPTURED} OR EXISTS (SELECT 1 FROM refunds r2 WHERE r2.payment_id = p.id AND r2.org_id = ${w.orgId}))`);
    return rows.map((r) => ({ day: text(r.day), paymentId: text(r.id), status: text(r.status), amount: money(r.amount), refunded: money(r.refunded) }));
  });
}

async function readInvoices(w: Window): Promise<RuleRead<Dated<InvoiceRow>>> {
  return runReconReadOnly(async (tx) => {
    const rows = await tx.execute<Record<string, unknown>>(sql`
      SELECT o.id, ${DAY} AS day, o.invoice_number, o.invoiced_at,
        EXISTS (SELECT 1 FROM payments p WHERE p.order_id = o.id AND p.org_id = ${w.orgId} AND p.status IN ${EVER_CAPTURED}) AS has_capture
      FROM orders o
      WHERE ${orderWindow(w)} AND ${settledMoney(w)}`);
    return rows.map((r) => ({
      day: text(r.day),
      orderId: text(r.id),
      invoiceNumber: r.invoice_number === null ? null : text(r.invoice_number),
      invoicedAt: r.invoiced_at === null ? null : new Date(String(r.invoiced_at)),
      hasCapture: r.has_capture === true,
    }));
  });
}

async function readInvoiceNumbers(orgId: string, date: string): Promise<RuleRead<string>> {
  const year = financialYear(new Date(`${date}T12:00:00+05:30`));
  return runReconReadOnly(async (tx) => {
    const rows = await tx.execute<{ invoice_number: string }>(sql`
      SELECT invoice_number FROM orders WHERE org_id = ${orgId} AND invoice_number LIKE ${`${year}/%`}`);
    return rows.map((r) => r.invoice_number);
  });
}

/**
 * The per-line tuples the GST rule re-prices: [net, rate_bps, taxable, tax].
 * Amounts arrive as text and become bigint — a JSON number would be a float,
 * which money never is. The rate is a small integer (bps), not money.
 */
function gstLinesOf(value: unknown): GstLine[] {
  const rows = Array.isArray(value) ? value : JSON.parse(String(value ?? "[]"));
  return (rows as [string, number, string, string][]).map(([net, rateBps, taxable, tax]) => ({
    net: money(net),
    rateBps: int(rateBps) as Bps,
    taxable: money(taxable),
    tax: money(tax),
  }));
}

async function readGstLines(w: Window): Promise<RuleRead<Dated<GstLinesRow>>> {
  return runReconReadOnly(async (tx) => {
    const rows = await tx.execute<Record<string, unknown>>(sql`
      SELECT o.id, ${DAY} AS day, o.delivery_fee::text AS delivery_fee, o.taxable_total::text AS taxable_total, o.tax_total::text AS tax_total,
        coalesce(sum(oi.line_taxable), 0)::text AS line_taxable_sum, coalesce(sum(oi.line_tax), 0)::text AS line_tax_sum,
        (o.status = 'REFUNDED' OR EXISTS (SELECT 1 FROM refunds r WHERE r.order_id = o.id AND r.org_id = ${w.orgId} AND ${COUNTED_REFUND})) AS refunded,
        coalesce(
          jsonb_agg(jsonb_build_array((oi.line_subtotal - oi.line_discount)::text, oi.tax_rate_bps, oi.line_taxable::text, oi.line_tax::text))
            FILTER (WHERE oi.id IS NOT NULL),
          '[]'::jsonb
        ) AS lines
      FROM orders o
      LEFT JOIN order_items oi ON oi.order_id = o.id AND oi.org_id = ${w.orgId}
      WHERE ${orderWindow(w)} AND ${settledMoney(w)} AND ${PRICED_ORDER}
      GROUP BY o.id`);
    return rows.map((r) => ({
      day: text(r.day),
      orderId: text(r.id),
      deliveryFee: money(r.delivery_fee),
      taxableTotal: money(r.taxable_total),
      taxTotal: money(r.tax_total),
      lineTaxableSum: money(r.line_taxable_sum),
      lineTaxSum: money(r.line_tax_sum),
      refunded: r.refunded === true,
      lines: gstLinesOf(r.lines),
    }));
  });
}

async function readLoyaltyRefunds(w: Window): Promise<RuleRead<Dated<LoyaltyRefundRow>>> {
  return runReconReadOnly(async (tx) => {
    const rows = await tx.execute<Record<string, unknown>>(sql`
      SELECT o.id, ${DAY} AS day, o.points_earned, o.customer_id IS NOT NULL AS has_customer,
        EXISTS (SELECT 1 FROM loyalty_transactions lt WHERE lt.org_id = ${w.orgId} AND lt.order_id = o.id AND lt.reason LIKE 'Reversed —%') AS points_reversed,
        EXISTS (SELECT 1 FROM loyalty_stamp_events se WHERE se.org_id = ${w.orgId} AND se.order_id = o.id AND se.reversed_at IS NULL) AS stamp_held
      FROM orders o
      WHERE ${orderWindow(w)} AND o.status = 'REFUNDED'`);
    return rows.map((r) => ({
      day: text(r.day),
      orderId: text(r.id),
      pointsEarned: int(r.points_earned),
      hasCustomer: r.has_customer === true,
      pointsReversed: r.points_reversed === true,
      stampHeld: r.stamp_held === true,
    }));
  });
}

/** Totals compared between one day's facts and the live P&L and food-cost figures. */
const PARITY_METRICS = ["revenue_net", "orders_paid", "expense_direct", "expense_operating", "expense_nonoperating", "food_cost_theoretical", "food_cost_actual", "sale_lines_total"] as const;
type ParityMetric = (typeof PARITY_METRICS)[number];

type ParityFigures = Partial<Record<ParityMetric, bigint>>;

function figure(figures: ParityFigures, metric: ParityMetric): bigint {
  return figures[metric] ?? 0n;
}

/** The instants the parity read scans, and the age guard it applies, for the days asked for. */
function parityWindow(orgId: string, dates: readonly string[], now: Date): Window {
  return { orgId, from: startOfBusinessDay(dates[0]!), to: endOfBusinessDay(dates.at(-1)!), settled: new Date(now.getTime() - RECON_MIN_ROW_AGE_MS) };
}

/**
 * Per-day facts parity: each day's stored facts against the same figures
 * computed live, exactly (bigint).
 *
 * Both sides are read inside one `runReconReadOnly` transaction, so they come
 * from one REPEATABLE READ snapshot: a refund, expense or stock movement that
 * commits mid-run can no longer make a day that agrees look like a mismatch.
 * That was RELIABILITY's condition for parity gating the detectors
 * (`parityFlagged`), and it is why the live figures are SQL here rather than
 * calls to `getProfitAndLoss` / `getFoodCostComparison`, which take no
 * transaction (card iq1-par, another owner). The definitions below must stay
 * in step with those two functions and with `saleSetWhere`; the integration
 * test compares this path against them on the same data.
 *
 * Not checked, never a pass:
 * - a day with no computed facts (`facts_not_computed`);
 * - a day whose orders, payments, refunds, expenses or stock movements moved
 *   inside the 5-minute age guard (`rows_recently_changed`) — the same guard
 *   the row rules use, applied to the whole day because parity compares sums.
 */
export async function readFactsParity(orgId: string, dates: readonly string[], now: Date): Promise<RuleRead<FactsParityDay>> {
  const first = dates[0]!;
  const last = dates.at(-1)!;
  const w = parityWindow(orgId, dates, now);
  return runReconReadOnly(async (tx) => {
    // One snapshot for every statement below: REPEATABLE READ takes it at the
    // first query and holds it for the transaction.
    const factRows = await tx.execute<{ day: string; metric_id: string; value: string }>(sql`
      SELECT business_date::text AS day, metric_id, sum(value)::text AS value
      FROM iq_daily_facts
      WHERE org_id = ${w.orgId} AND definition_version = ${FACTS_DEFINITION_VERSION} AND dimension_key = ''
        AND business_date >= ${first} AND business_date <= ${last}
      GROUP BY 1, 2`);

    // Revenue is net of GST (taxable_total, never grand_total) over the sale
    // set: paid, not cancelled/failed/refunded (analytics.ts saleSetWhere).
    const saleRows = await tx.execute<{ day: string; revenue_net: string; orders_paid: number }>(sql`
      SELECT ${DAY} AS day, coalesce(sum(o.taxable_total), 0)::text AS revenue_net, count(*)::int AS orders_paid
      FROM orders o
      WHERE o.org_id = ${w.orgId} AND o.created_at >= ${w.from.toISOString()} AND o.created_at < ${w.to.toISOString()}
        AND o.status NOT IN ('CANCELLED', 'FAILED', 'REFUNDED')
        AND EXISTS (SELECT 1 FROM payments pp WHERE pp.order_id = o.id AND pp.org_id = ${w.orgId} AND pp.status IN ${PAID_PAYMENT})
      GROUP BY 1`);

    // Expenses are dated by paid_on, which is already an IST business date
    // (expenses.ts businessDateBounds). Operating direct / operating fixed /
    // non-operating, the three lines shapeProfitAndLoss sums.
    const expenseRows = await tx.execute<{ day: string; direct: string; operating: string; non_operating: string }>(sql`
      SELECT e.paid_on::text AS day,
        coalesce(sum(e.amount) FILTER (WHERE c.behaviour = 'DIRECT' AND NOT c.is_non_operating), 0)::text AS direct,
        coalesce(sum(e.amount) FILTER (WHERE c.behaviour = 'FIXED' AND NOT c.is_non_operating), 0)::text AS operating,
        coalesce(sum(e.amount) FILTER (WHERE c.is_non_operating), 0)::text AS non_operating
      FROM expenses e
      JOIN expense_categories c ON c.id = e.category_id AND c.org_id = ${w.orgId}
      WHERE e.org_id = ${w.orgId} AND e.paid_on >= ${first} AND e.paid_on <= ${last}
      GROUP BY 1`);

    const movementRows = await tx.execute<{ day: string; theoretical: string; actual: string; sale_lines: number }>(sql`
      SELECT ${sql.raw(`${businessDateSql("im.occurred_at")}::text`)} AS day,
        coalesce(sum(im.total_cost) FILTER (WHERE im.type = 'SALE'), 0)::text AS theoretical,
        coalesce(sum(im.total_cost) FILTER (WHERE im.type IN ('SALE', 'WASTE') OR (im.type = 'ADJUSTMENT' AND im.quantity < 0)), 0)::text AS actual,
        (count(*) FILTER (WHERE im.type = 'SALE'))::int AS sale_lines
      FROM inventory_movements im
      WHERE im.org_id = ${w.orgId} AND im.occurred_at >= ${w.from.toISOString()} AND im.occurred_at < ${w.to.toISOString()}
      GROUP BY 1`);

    // The age guard, per day: anything a figure above depends on that moved
    // inside the last 5 minutes leaves the whole day unchecked.
    const movingRows = await tx.execute<{ day: string }>(sql`
      SELECT ${DAY} AS day FROM orders o
        WHERE o.org_id = ${w.orgId} AND o.created_at >= ${w.from.toISOString()} AND o.created_at < ${w.to.toISOString()}
          AND (o.updated_at >= ${w.settled.toISOString()} OR NOT (${settledMoney(w)}))
      UNION
      SELECT e.paid_on::text AS day FROM expenses e
        WHERE e.org_id = ${w.orgId} AND e.paid_on >= ${first} AND e.paid_on <= ${last} AND e.updated_at >= ${w.settled.toISOString()}
      UNION
      SELECT ${sql.raw(`${businessDateSql("im.occurred_at")}::text`)} AS day FROM inventory_movements im
        WHERE im.org_id = ${w.orgId} AND im.occurred_at >= ${w.from.toISOString()} AND im.occurred_at < ${w.to.toISOString()}
          AND im.created_at >= ${w.settled.toISOString()}`);

    const facts = new Map<string, ParityFigures>();
    const computedDays = new Set<string>();
    for (const row of factRows) {
      const day = facts.get(row.day) ?? {};
      if (PARITY_METRICS.includes(row.metric_id as ParityMetric)) day[row.metric_id as ParityMetric] = BigInt(row.value);
      facts.set(row.day, day);
      // The same definition of "this day has facts" as readDailyFacts.
      if (row.metric_id === "orders_paid") computedDays.add(row.day);
    }

    const live = new Map<string, ParityFigures>();
    const put = (day: string, figures: ParityFigures) => live.set(day, { ...live.get(day), ...figures });
    for (const row of saleRows) put(text(row.day), { revenue_net: BigInt(row.revenue_net), orders_paid: BigInt(int(row.orders_paid)) });
    for (const row of expenseRows) {
      put(text(row.day), { expense_direct: BigInt(row.direct), expense_operating: BigInt(row.operating), expense_nonoperating: BigInt(row.non_operating) });
    }
    for (const row of movementRows) {
      put(text(row.day), { food_cost_theoretical: BigInt(row.theoretical), food_cost_actual: BigInt(row.actual), sale_lines_total: BigInt(int(row.sale_lines)) });
    }
    const moving = new Set(movingRows.map((row) => text(row.day)));

    return dates.map((date): FactsParityDay => {
      if (moving.has(date)) return { date, checked: false, notCheckedReason: "rows_recently_changed", mismatchedMetrics: [] };
      if (!computedDays.has(date)) return { date, checked: false, notCheckedReason: "facts_not_computed", mismatchedMetrics: [] };
      const stored = facts.get(date) ?? {};
      const actual = live.get(date) ?? {};
      return { date, checked: true, notCheckedReason: null, mismatchedMetrics: PARITY_METRICS.filter((metric) => figure(stored, metric) !== figure(actual, metric)) };
    });
  });
}

/** The day's t6_payment_integrity trust row, as the engine's FigureTrust; null when the day was not scored. */
async function readT6Trust(orgId: string, dates: readonly string[]): Promise<Record<string, FigureTrust | null>> {
  const rows = await db().execute<{ business_date: string; grade: string; numerator: string; denominator: string; computed_at: string }>(sql`
    SELECT business_date::text AS business_date, grade, numerator::text AS numerator, denominator::text AS denominator, computed_at
    FROM iq_daily_trust
    WHERE org_id = ${orgId} AND signal_id = 't6_payment_integrity' AND definition_version = ${TRUST_DEFINITION_VERSION}
      AND business_date >= ${dates[0]} AND business_date <= ${dates.at(-1)}`);
  const byDate: Record<string, FigureTrust | null> = Object.fromEntries(dates.map((d) => [d, null]));
  for (const row of rows) {
    const denominator = BigInt(row.denominator);
    const at = new Date(String(row.computed_at));
    byDate[row.business_date] = {
      grade: row.grade as FigureTrust["grade"],
      signalId: "t6_payment_integrity",
      ratio: denominator > 0n ? { numerator: BigInt(row.numerator), denominator } : null,
      asOf: `${new Date(at.getTime() + 330 * 60_000).toISOString().slice(0, 19)}+05:30`,
    };
  }
  return byDate;
}

/** Everything the rules need for the window ending on `date`, each rule in its own read-only snapshot. */
export async function readReconWindow(orgId: string, date: string, now: Date): Promise<ReconWindowRead> {
  const dates = reconWindow(date);
  const w: Window = { orgId, from: startOfBusinessDay(dates[0]!), to: endOfBusinessDay(date), settled: new Date(now.getTime() - RECON_MIN_ROW_AGE_MS) };
  const [org] = await db().execute<{ price_basis: PriceBasis; closing_time: string }>(
    sql`SELECT price_basis::text AS price_basis, closing_time FROM ${organizations} WHERE id = ${orgId}`,
  );
  if (!org) throw new Error("iq-recon: organization not found");

  // Sequential: each is short, and the job must not hold eight connections.
  const orderTotals = await readOrderTotals(w);
  const captures = await readCaptures(w);
  const statusPayments = await readStatusPayments(w);
  const refundPayments = await readRefundPayments(w);
  const invoices = await readInvoices(w);
  const invoiceNumbers = await readInvoiceNumbers(orgId, date);
  const gstLines = await readGstLines(w);
  const loyaltyRefunds = await readLoyaltyRefunds(w);
  const parity = await readFactsParity(orgId, dates, now);

  return { date, dates, basis: org.price_basis, closingTime: org.closing_time, orderTotals, captures, statusPayments, refundPayments, invoices, invoiceNumbers, gstLines, loyaltyRefunds, parity };
}

/**
 * The job's read (`ReconcileJobPorts.readRecon`): reads the window, runs the
 * pure rules, and mints the Observed figures of every fired outcome. Bound to
 * the job through `JobReadRepos` (AUTOMATION-ARCHITECT).
 */
export async function readRecon(orgId: string, date: string, now: Date): Promise<ReconRunRead> {
  const read = await readReconWindow(orgId, date, now);
  const outcomes = evaluateReconWindow(read, now).map((outcome) => {
    if (outcome.status !== "FIRED") return { outcome, counts: null };
    const counts: ReconCounts = {
      unexplained: observed({ unit: "count", value: outcome.unexplained }),
      explained: observed({ unit: "count", value: outcome.explained }),
      amount: outcome.amount !== null && outcome.amount > 0n ? observedPaise(outcome.amount) : null,
    };
    return { outcome, counts };
  });
  const zero: { count: Observed; paise: Observed } = { count: observed({ unit: "count", value: 0 }), paise: observedPaise(0n) };
  return { from: read.dates[0]!, to: date, outcomes, zeroCount: zero.count, zeroPaise: zero.paise, trustByDate: await readT6Trust(orgId, read.dates) };
}

/** How many days `readRecon` evaluates per run, for the job's budget. */
export const RECON_DAYS_PER_RUN = RECON_WINDOW_DAYS;
