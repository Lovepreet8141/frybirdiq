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
 * Refunds: this schema has no refund status yet, so every refunds row counts
 * (R2.6 "today"); the refund release switches `COUNTED_REFUND` to
 * SUCCEEDED rows only.
 */
import { sql } from "drizzle-orm";

import { db } from "@/db";
import { organizations } from "@/db/schema";
import { type DateRange, endOfBusinessDay, startOfBusinessDay } from "@/lib/dates";
import type { FigureTrust, Observed } from "@/lib/iq/engine";
import { observed, observedPaise } from "@/lib/iq/engine/observed-factory";
import { businessDateSql } from "@/lib/iq/metrics";
import type { ReconCounts, ReconRunRead } from "@/lib/iq/reconcile/reconcile-job";
import {
  type CaptureRow,
  type Dated,
  type FactsParityDay,
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
import { paise } from "@/lib/money";
import type { PriceBasis } from "@/lib/pricing";

import { getProfitAndLoss } from "./expenses";
import { readDailyFacts } from "./iq-facts";
import { TRUST_DEFINITION_VERSION } from "./iq-trust";
import { getFoodCostComparison } from "./stock";

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
/** Refund rows that count as money back. Today every row; SUCCEEDED only once refunds carry a status. */
const COUNTED_REFUND = sql.raw(`TRUE`);
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

async function readGstLines(w: Window): Promise<RuleRead<Dated<GstLinesRow>>> {
  return runReconReadOnly(async (tx) => {
    const rows = await tx.execute<Record<string, unknown>>(sql`
      SELECT o.id, ${DAY} AS day, o.delivery_fee::text AS delivery_fee, o.taxable_total::text AS taxable_total, o.tax_total::text AS tax_total,
        coalesce(sum(oi.line_taxable), 0)::text AS line_taxable_sum, coalesce(sum(oi.line_tax), 0)::text AS line_tax_sum,
        (o.status = 'REFUNDED' OR EXISTS (SELECT 1 FROM refunds r WHERE r.order_id = o.id AND r.org_id = ${w.orgId})) AS refunded
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

/**
 * Per-day facts parity: each day's computed facts against the live P&L and
 * food-cost figures for that day, exactly (bigint). A day without computed
 * facts is `computed: false` — "not checked", never a pass. This is also the
 * per-day flag the detectors read (`parityFlagged`, god's ruling on iq2-s7).
 */
export async function readFactsParityDays(orgId: string, dates: readonly string[]): Promise<FactsParityDay[]> {
  const out: FactsParityDay[] = [];
  for (const date of dates) {
    const facts = await readDailyFacts(orgId, date, date);
    if (facts.missingDates.length > 0) {
      out.push({ date, computed: false, mismatchedMetrics: [] });
      continue;
    }
    const range: DateRange = { from: startOfBusinessDay(date), to: endOfBusinessDay(date), label: date };
    const [pnl, food] = await Promise.all([getProfitAndLoss(orgId, range), getFoodCostComparison(orgId, range)]);
    const sum = (rows: readonly { amount: bigint }[]) => rows.reduce((total, row) => total + row.amount, 0n);
    const live: Record<(typeof PARITY_METRICS)[number], bigint> = {
      revenue_net: pnl.revenue,
      orders_paid: BigInt(pnl.orderCount),
      expense_direct: sum(pnl.direct),
      expense_operating: sum(pnl.fixed),
      expense_nonoperating: sum(pnl.nonOperating),
      food_cost_theoretical: food.theoreticalCost,
      food_cost_actual: food.actualCost,
      sale_lines_total: BigInt(food.saleMovementCount),
    };
    out.push({ date, computed: true, mismatchedMetrics: PARITY_METRICS.filter((metric) => (facts.totals[metric] ?? 0n) !== live[metric]) });
  }
  return out;
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
  let parity: RuleRead<FactsParityDay>;
  try {
    parity = { status: "evaluated", rows: await readFactsParityDays(orgId, dates) };
  } catch (error) {
    const e = error as { code?: string; cause?: { code?: string } };
    if ((e.cause?.code ?? e.code) !== "57014") throw error;
    parity = { status: "timeout" };
  }

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
