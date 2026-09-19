/**
 * IQ-2 S4 — the reconciliation rules, as pure checks over rows the
 * repository (`src/lib/repositories/iq-recon.ts`) read in one read-only
 * snapshot per rule.
 *
 * hive/reviews/iq-2/DESIGN.md Revision 2: R2.6 (the rules), R2.5 (read path),
 * and hive/reviews/iq-2/REVIEW-FINANCE-LEDGER.md F1–F4.
 *
 * Every check is exact integer paise: amounts arrive as `Paise` (bigint),
 * arithmetic goes through `src/lib/money`, nothing here formats money or
 * touches a float. A rule never corrects anything; it reports.
 *
 * Refunds: only a refund that landed counts as money back — SUCCEEDED on
 * finalized_at (migration 0038). The repository decides that once,
 * `COUNTED_REFUND` in `iq-recon.ts`, and every rule here reads the result; a
 * RESERVED or FAILED attempt is not a refund and must not move a figure.
 */
import { financialYear, parseInvoiceNumber } from "@/lib/invoice";
import { addDays } from "@/lib/dates";
import { type Bps, type Paise, ZERO, add, negate, subtract } from "@/lib/money";
import type { PriceBasis } from "@/lib/pricing";
import { gst } from "@/lib/tax/gst";

import { explainCaptureMismatch } from "./explanations";

export const RECON_RULE_VERSION = 1;

export const RECON_RULE_IDS = [
  "recon.facts_parity",
  "recon.order_totals",
  "recon.capture_vs_total",
  "recon.status_vs_payment",
  "recon.refund_vs_payment",
  "recon.invoice",
  "recon.gst_lines",
  "recon.loyalty_refund",
] as const;
export type ReconRuleId = (typeof RECON_RULE_IDS)[number];

export const RECON_SEVERITY: Readonly<Record<ReconRuleId, 1 | 2 | 3>> = {
  "recon.facts_parity": 3,
  "recon.order_totals": 3,
  "recon.capture_vs_total": 2,
  "recon.status_vs_payment": 3,
  "recon.refund_vs_payment": 3,
  "recon.invoice": 3,
  "recon.gst_lines": 2,
  "recon.loyalty_refund": 2,
};

/** Rows changed more recently than this are left for the next run: a live request may still be writing them (R2.5). */
export const RECON_MIN_ROW_AGE_MS = 5 * 60_000;

/** An unpaid order still in the kitchen or on the road is legitimate until its day's closing time plus this (F4). */
export const PAY_LATER_GRACE_MS = 60 * 60_000;

/* ------------------------------------------------------------------ */
/* recon.order_totals — F1                                              */
/* ------------------------------------------------------------------ */

/** One order's stored totals and the sums of its lines, as the repository read them. */
export type OrderTotalsRow = {
  readonly orderId: string;
  readonly subtotal: Paise;
  readonly discountTotal: Paise;
  readonly taxableTotal: Paise;
  readonly taxTotal: Paise;
  readonly cgstTotal: Paise;
  readonly sgstTotal: Paise;
  readonly igstTotal: Paise;
  readonly deliveryFee: Paise;
  readonly packagingFee: Paise;
  readonly tipAmount: Paise;
  readonly grandTotal: Paise;
  readonly stampRewardDiscount: Paise;
  readonly pointsRedeemed: number;
  readonly lineSubtotalSum: Paise;
  readonly lineDiscountSum: Paise;
  /** How many lines the order has — the number of separate CGST/SGST allocations behind its totals. */
  readonly lineCount: number;
  /** Lines where line_taxable + line_tax ≠ line_subtotal − line_discount. */
  readonly linesOffInclusive: number;
  /** Lines where line_taxable ≠ line_subtotal − line_discount. */
  readonly linesOffExclusive: number;
};

export type OrderTotalsBreak =
  | "LINE_SUBTOTALS"
  | "LINE_DISCOUNTS"
  | "LINE_IDENTITY"
  | "ORDER_IDENTITY"
  | "UNUSED_FEES"
  | "TAX_SPLIT"
  | "IGST_PRESENT"
  | "CGST_SGST_UNEVEN"
  | "STAMP_DISCOUNT"
  | "GRAND_TOTAL"
  | "POINTS_RANGE";

/**
 * The intra-state shape of the split, not just its sum. FRYBIRD is one
 * location in Haryana and every supply is intra-state, so `splitTax` puts the
 * whole tax in CGST and SGST — half each, with the odd paise allocated — and
 * nothing in IGST. An order with its tax all in CGST, or any of it in IGST,
 * still satisfies cgst + sgst + igst = tax_total and would reconcile
 * perfectly against the order total while filing GSTR-1 wrong.
 *
 * The tolerance is one paise per allocation, and there is one per line plus
 * one for the delivery fee (`priceOrder` prices fees alongside lines).
 */
function taxSplitShapeBreaks(row: OrderTotalsRow): OrderTotalsBreak[] {
  const breaks: OrderTotalsBreak[] = [];
  if (row.igstTotal !== ZERO) breaks.push("IGST_PRESENT");
  const gap = subtract(row.cgstTotal, row.sgstTotal);
  const spread = gap < ZERO ? negate(gap) : gap;
  if (spread > BigInt(row.lineCount + 1)) breaks.push("CGST_SGST_UNEVEN");
  return breaks;
}

/**
 * Which pricing identities an order's stored figures break. Empty means the
 * order is internally consistent. Points: the paise discount is not stored
 * (only points_redeemed), so an order that spent points gets a range check,
 * not an exact one, until the points_discount snapshot exists (S14).
 */
export function orderTotalsBreaks(row: OrderTotalsRow, basis: PriceBasis): OrderTotalsBreak[] {
  const breaks: OrderTotalsBreak[] = [];
  const net = subtract(row.subtotal, row.discountTotal);
  const gross = add(row.taxableTotal, row.taxTotal);

  if (row.lineSubtotalSum !== row.subtotal) breaks.push("LINE_SUBTOTALS");
  if (row.lineDiscountSum !== row.discountTotal) breaks.push("LINE_DISCOUNTS");
  if ((basis === "inclusive" ? row.linesOffInclusive : row.linesOffExclusive) > 0) breaks.push("LINE_IDENTITY");

  const expected = add(net, row.deliveryFee);
  if ((basis === "inclusive" ? gross : row.taxableTotal) !== expected) breaks.push("ORDER_IDENTITY");

  if (row.packagingFee !== ZERO || row.tipAmount !== ZERO) breaks.push("UNUSED_FEES");
  if (add(row.cgstTotal, row.sgstTotal, row.igstTotal) !== row.taxTotal) breaks.push("TAX_SPLIT");
  breaks.push(...taxSplitShapeBreaks(row));
  if (row.stampRewardDiscount < ZERO || row.stampRewardDiscount > row.discountTotal) breaks.push("STAMP_DISCOUNT");

  if (row.pointsRedeemed === 0) {
    if (row.grandTotal !== gross) breaks.push("GRAND_TOTAL");
  } else {
    const pointsDiscount = subtract(gross, row.grandTotal);
    if (pointsDiscount <= ZERO || pointsDiscount > gross) breaks.push("POINTS_RANGE");
  }
  return breaks;
}

/* ------------------------------------------------------------------ */
/* recon.capture_vs_total                                               */
/* ------------------------------------------------------------------ */

/** A sale-set order and what was ever captured against it. */
export type CaptureRow = {
  readonly orderId: string;
  readonly grandTotal: Paise;
  /** Σ amount of payments CAPTURED, PARTIALLY_REFUNDED or REFUNDED (F8). */
  readonly capturedEver: Paise;
  readonly captureCount: number;
  /** When the latest ever-captured payment was created. */
  readonly lastCaptureCreatedAt: Date;
};

export function captureMismatch(row: CaptureRow): boolean {
  return row.capturedEver !== row.grandTotal;
}

/** |captured − grand total|, the money the mismatch is about. */
export function captureDifference(row: CaptureRow): Paise {
  const diff = subtract(row.capturedEver, row.grandTotal);
  return diff < ZERO ? negate(diff) : diff;
}

/* ------------------------------------------------------------------ */
/* recon.status_vs_payment — F4                                         */
/* ------------------------------------------------------------------ */

export type StatusPaymentRow = {
  readonly orderId: string;
  readonly status: string;
  /** IST business date "YYYY-MM-DD" stored on the order. */
  readonly businessDate: string;
  readonly hasCapture: boolean;
};

const PAID_STATES = new Set(["PAID", "COMPLETED"]);
const PAY_LATER_STATES = new Set(["ACCEPTED", "PREPARING", "READY", "OUT_FOR_DELIVERY"]);

/** The instant "HH:MM" IST on `date`, plus `graceMs`. */
export function closingDeadline(date: string, closingTime: string, graceMs: number): Date {
  return new Date(Date.parse(`${date}T${closingTime}:00+05:30`) + graceMs);
}

/**
 * PAID or COMPLETED without an ever-captured payment is wrong at any age:
 * settle() captures and sets PAID together, and the rider cash path captures
 * before COMPLETED. An order still being made or delivered may be unpaid
 * (cash on delivery, dine-in pay later) until its day's closing time + 60 min.
 */
export function statusPaymentBroken(row: StatusPaymentRow, closingTime: string, now: Date): boolean {
  if (row.hasCapture) return false;
  if (PAID_STATES.has(row.status)) return true;
  if (PAY_LATER_STATES.has(row.status)) return now.getTime() > closingDeadline(row.businessDate, closingTime, PAY_LATER_GRACE_MS).getTime();
  return false;
}

/* ------------------------------------------------------------------ */
/* recon.refund_vs_payment                                              */
/* ------------------------------------------------------------------ */

export type RefundPaymentRow = {
  readonly paymentId: string;
  readonly status: string;
  readonly amount: Paise;
  /** Σ refunds counted against the payment (every row today; SUCCEEDED after the refund release). */
  readonly refunded: Paise;
};

export type RefundBreak = "OVER_REFUNDED" | "REFUNDED_SHORT" | "PARTIAL_EMPTY" | "PARTIAL_FULL" | "REFUND_ON_CAPTURED";

export function refundPaymentBreak(row: RefundPaymentRow): RefundBreak | null {
  if (row.refunded > row.amount) return "OVER_REFUNDED";
  if (row.status === "REFUNDED" && row.refunded < row.amount) return "REFUNDED_SHORT";
  if (row.status === "PARTIALLY_REFUNDED" && row.refunded === ZERO) return "PARTIAL_EMPTY";
  if (row.status === "PARTIALLY_REFUNDED" && row.refunded === row.amount) return "PARTIAL_FULL";
  if (row.status === "CAPTURED" && row.refunded > ZERO) return "REFUND_ON_CAPTURED";
  return null;
}

/** Money refunded beyond what the payment took; zero when not over-refunded. */
export function overRefund(row: RefundPaymentRow): Paise {
  return row.refunded > row.amount ? subtract(row.refunded, row.amount) : ZERO;
}

/* ------------------------------------------------------------------ */
/* recon.invoice — F2, PAY P3                                           */
/* ------------------------------------------------------------------ */

export type InvoiceRow = {
  readonly orderId: string;
  readonly invoiceNumber: string | null;
  readonly invoicedAt: Date | null;
  readonly hasCapture: boolean;
};

export type InvoiceBreak = "CAPTURED_NOT_INVOICED" | "INVOICED_NOT_CAPTURED" | "MALFORMED_NUMBER" | "WRONG_FINANCIAL_YEAR";

export function invoiceBreak(row: InvoiceRow): InvoiceBreak | null {
  const invoiced = row.invoiceNumber !== null || row.invoicedAt !== null;
  if (row.hasCapture && (row.invoiceNumber === null || row.invoicedAt === null)) return "CAPTURED_NOT_INVOICED";
  if (!invoiced) return null;
  if (!row.hasCapture) return "INVOICED_NOT_CAPTURED";
  const parsed = parseInvoiceNumber(row.invoiceNumber ?? "");
  if (!parsed) return "MALFORMED_NUMBER";
  if (row.invoicedAt !== null && financialYear(row.invoicedAt) !== parsed.financialYear) return "WRONG_FINANCIAL_YEAR";
  return null;
}

/**
 * Sequence problems in one financial year's issued numbers. There is no
 * legitimate gap: since 4ec0274 a number is max + 1 in the same transaction
 * that sets PAID, and a rolled-back attempt uses none (F2). Duplicates are
 * blocked by UNIQUE (org_id, invoice_number); the check guards the constraint.
 *
 * `gaps` is max − unique, which assumes the year's series starts at 1. That
 * holds for a series only ever minted by max + 1. If an org's financial year
 * is ever started above 1 — a backfill, a migration, a series carried in from
 * a previous book — every night would report start − 1 unexplained gaps, and
 * the fix is to compare against that org's first issued number rather than to
 * loosen the rule. Rule 46 numbering is the first thing a CA looks at.
 */
export function invoiceSequenceBreaks(numbers: readonly string[], year: string): { readonly gaps: number; readonly duplicates: number } {
  const sequences = numbers
    .map((n) => parseInvoiceNumber(n))
    .filter((p): p is NonNullable<typeof p> => p !== null && p.financialYear === year)
    .map((p) => p.sequence);
  const unique = new Set(sequences);
  const max = sequences.reduce((m, s) => (s > m ? s : m), 0);
  return { gaps: max - unique.size, duplicates: sequences.length - unique.size };
}

/* ------------------------------------------------------------------ */
/* recon.gst_lines                                                      */
/* ------------------------------------------------------------------ */

/** One stored sale line, as `priceLine` wrote it: its taxed amount, its own rate, and the tax it booked. */
export type GstLine = {
  /** line_subtotal − line_discount: the amount GST was computed on. */
  readonly net: Paise;
  readonly rateBps: Bps;
  readonly taxable: Paise;
  readonly tax: Paise;
};

export type GstLinesRow = {
  readonly orderId: string;
  readonly deliveryFee: Paise;
  readonly taxableTotal: Paise;
  readonly taxTotal: Paise;
  readonly lineTaxableSum: Paise;
  readonly lineTaxSum: Paise;
  /** A refund that actually landed (SUCCEEDED), or the order itself REFUNDED. */
  readonly refunded: boolean;
  readonly lines: readonly GstLine[];
};

export type GstLinesBreak = "LINE_TAX_MISMATCH" | "FEE_GST_MISMATCH" | "NOT_CHECKED_REFUNDED";

/**
 * Every line's tax against its own stored rate. `priceLine` books
 * `gst(line_subtotal − line_discount, tax_rate_bps, basis)`, and the rate and
 * the amounts are all snapshot columns, so the check is exact rather than a
 * tolerance.
 *
 * This is the only rule that would notice paise moved from line_tax into
 * line_taxable: that tamper keeps every sum in this file intact — taxable +
 * tax per line, the totals identity, the fee residual, cgst + sgst + igst —
 * while the output GST actually filed is short.
 */
export function lineTaxBroken(row: GstLinesRow, basis: PriceBasis): boolean {
  return row.lines.some((line) => {
    const expected = gst(line.net, line.rateBps, { basis });
    return line.taxable !== expected.taxable || line.tax !== expected.total;
  });
}

/**
 * The delivery fee's GST lives in the order totals, not on a line, so the
 * part of the totals no line explains must be exactly the fee. Under
 * `inclusive` the fee contains its tax, so taxable + tax = delivery_fee;
 * under `exclusive` the tax is added on top, so taxable = delivery_fee. The
 * basis comes from the organization (`src/lib/pricing`) and is never decided
 * here. Stored data, so D9 (the export's omission) never explains a break.
 */
export function feeGstBroken(row: GstLinesRow, basis: PriceBasis): boolean {
  const feeTaxable = subtract(row.taxableTotal, row.lineTaxableSum);
  const feeTax = subtract(row.taxTotal, row.lineTaxSum);
  if (feeTaxable < ZERO || feeTax < ZERO) return true;
  if (row.deliveryFee === ZERO) return feeTaxable !== ZERO || feeTax !== ZERO;
  return basis === "inclusive" ? add(feeTaxable, feeTax) !== row.deliveryFee : feeTaxable !== row.deliveryFee;
}

/**
 * What the GST-line rule says about one order.
 *
 * A refund does not rewrite lines, so the per-line rate check runs on every
 * order — leaving it off for refunded orders is exactly the hole a plant
 * would use. Only the fee residual is held back, because how a credit note
 * restates the order's own GST is dec-9, still open with the CA; that
 * exclusion is reported as NOT_CHECKED_REFUNDED rather than being silent, and
 * carries dec-9 as its explanation so it is shown and counted without
 * alarming.
 */
export function gstLinesBreak(row: GstLinesRow, basis: PriceBasis): GstLinesBreak | null {
  if (lineTaxBroken(row, basis)) return "LINE_TAX_MISMATCH";
  if (row.refunded) return "NOT_CHECKED_REFUNDED";
  return feeGstBroken(row, basis) ? "FEE_GST_MISMATCH" : null;
}

/* ------------------------------------------------------------------ */
/* recon.loyalty_refund                                                 */
/* ------------------------------------------------------------------ */

export type LoyaltyRefundRow = {
  readonly orderId: string;
  /** Points the order earned a known customer. */
  readonly pointsEarned: number;
  readonly hasCustomer: boolean;
  /** A "Reversed —" points transaction exists for the order. */
  readonly pointsReversed: boolean;
  /** A stamp for the order that was never reversed. */
  readonly stampHeld: boolean;
};

/** A REFUNDED order that still holds its stamp, or earned points with no reversal. */
export function loyaltyStillHeld(row: LoyaltyRefundRow): boolean {
  return row.stampHeld || (row.hasCustomer && row.pointsEarned > 0 && !row.pointsReversed);
}

/* ------------------------------------------------------------------ */
/* recon.facts_parity                                                   */
/* ------------------------------------------------------------------ */

/** Why a day's parity was not checked: no computed facts, or rows that are still moving. */
export type ParityNotChecked = "facts_not_computed" | "rows_recently_changed";

export type FactsParityDay = {
  readonly date: string;
  /** False when the day was not compared at all: "not checked", never zero mismatches. */
  readonly checked: boolean;
  /** Why it was not checked; null when it was. */
  readonly notCheckedReason: ParityNotChecked | null;
  /** Metric ids whose facts differ from the live P&L and food-cost figures for the day. */
  readonly mismatchedMetrics: readonly string[];
};

/** The per-day flag the detectors read (god's ruling on iq2-s7): checked facts that disagree with live figures. */
export function parityFlagged(day: FactsParityDay): boolean {
  return day.checked && day.mismatchedMetrics.length > 0;
}

/* ------------------------------------------------------------------ */
/* Evaluation over a window of days                                     */
/* ------------------------------------------------------------------ */

/** How many IST days one run evaluates: D and the 35 before it (§1a "D-1 and trailing 35 days"). */
export const RECON_WINDOW_DAYS = 36;

/** The dates a run for `date` evaluates, oldest first. */
export function reconWindow(date: string): string[] {
  return Array.from({ length: RECON_WINDOW_DAYS }, (_, i) => addDays(date, i - (RECON_WINDOW_DAYS - 1)));
}

/** One rule's rows, or the fact that its read did not finish (statement timeout). */
export type RuleRead<Row> = { readonly status: "evaluated"; readonly rows: readonly Row[] } | { readonly status: "timeout" };

/** Rows carry the IST business day of their order's created_at. */
export type Dated<Row> = Row & { readonly day: string };

/** Everything one run read, for the window of days and the run's own day. */
export type ReconWindowRead = {
  /** The run's day (the newest in the window). */
  readonly date: string;
  readonly dates: readonly string[];
  readonly basis: PriceBasis;
  /** organizations.closing_time, "HH:MM" IST. */
  readonly closingTime: string;
  readonly orderTotals: RuleRead<Dated<OrderTotalsRow>>;
  readonly captures: RuleRead<Dated<CaptureRow>>;
  readonly statusPayments: RuleRead<Dated<StatusPaymentRow>>;
  readonly refundPayments: RuleRead<Dated<RefundPaymentRow>>;
  readonly invoices: RuleRead<Dated<InvoiceRow>>;
  /** Every invoice number issued in the financial year of `date`, for gaps and duplicates. */
  readonly invoiceNumbers: RuleRead<string>;
  readonly gstLines: RuleRead<Dated<GstLinesRow>>;
  readonly loyaltyRefunds: RuleRead<Dated<LoyaltyRefundRow>>;
  readonly parity: RuleRead<FactsParityDay>;
};

export type ReconOutcome =
  | { readonly ruleId: ReconRuleId; readonly date: string; readonly status: "NOT_EVALUATED"; readonly reason: "rule_timeout" | ParityNotChecked }
  | { readonly ruleId: ReconRuleId; readonly date: string; readonly status: "CLEAR" }
  | {
      readonly ruleId: ReconRuleId;
      readonly date: string;
      readonly status: "FIRED";
      /** Findings no known card explains — the Done-when count. */
      readonly unexplained: number;
      /** Findings a known card explains; shown, never hidden. */
      readonly explained: number;
      /** The card explaining them, when `explained` > 0. */
      readonly explainedBy: string | null;
      /** Money the findings are about (capture differences, over-refunds); null for rules that are not about an amount. */
      readonly amount: Paise | null;
      /** Break codes with counts, for the run summary. */
      readonly breaks: Readonly<Record<string, number>>;
    };

type Finding = { readonly day: string; readonly code: string; readonly amount?: Paise; readonly explainedBy?: string | null };

function outcomesFor<Row>(
  ruleId: ReconRuleId,
  dates: readonly string[],
  read: RuleRead<Row>,
  find: (row: Row) => Finding | null,
  withAmount: boolean,
): ReconOutcome[] {
  if (read.status === "timeout") return dates.map((date) => ({ ruleId, date, status: "NOT_EVALUATED", reason: "rule_timeout" }));
  const byDay = new Map<string, Finding[]>();
  for (const row of read.rows) {
    const finding = find(row);
    if (finding) byDay.set(finding.day, [...(byDay.get(finding.day) ?? []), finding]);
  }
  return dates.map((date): ReconOutcome => {
    const findings = byDay.get(date) ?? [];
    if (findings.length === 0) return { ruleId, date, status: "CLEAR" };
    const explained = findings.filter((f) => f.explainedBy);
    const breaks: Record<string, number> = {};
    for (const f of findings) breaks[f.code] = (breaks[f.code] ?? 0) + 1;
    return {
      ruleId,
      date,
      status: "FIRED",
      unexplained: findings.length - explained.length,
      explained: explained.length,
      explainedBy: explained[0]?.explainedBy ?? null,
      amount: withAmount ? add(...findings.map((f) => f.amount ?? ZERO)) : null,
      breaks,
    };
  });
}

/**
 * Every rule's outcome for every day of the window. A rule whose read timed
 * out is NOT_EVALUATED for every day (never expired); facts parity is
 * NOT_EVALUATED on a day without computed facts ("not checked").
 * Invoice gaps and duplicates are a financial-year question and are reported
 * on the run's own day.
 */
export function evaluateReconWindow(read: ReconWindowRead, now: Date): ReconOutcome[] {
  const { dates, date } = read;
  const outcomes: ReconOutcome[] = [];

  outcomes.push(
    ...outcomesFor("recon.order_totals", dates, read.orderTotals, (row) => {
      const breaks = orderTotalsBreaks(row, read.basis);
      return breaks.length > 0 ? { day: row.day, code: breaks[0]! } : null;
    }, false),
    ...outcomesFor("recon.capture_vs_total", dates, read.captures, (row) =>
      captureMismatch(row) ? { day: row.day, code: row.captureCount > 1 ? "MULTIPLE_CAPTURES" : "AMOUNT_MISMATCH", amount: captureDifference(row), explainedBy: explainCaptureMismatch(row) } : null,
    true),
    ...outcomesFor("recon.status_vs_payment", dates, read.statusPayments, (row) =>
      statusPaymentBroken(row, read.closingTime, now) ? { day: row.day, code: `${row.status}_WITHOUT_CAPTURE` } : null,
    false),
    ...outcomesFor("recon.refund_vs_payment", dates, read.refundPayments, (row) => {
      const code = refundPaymentBreak(row);
      return code ? { day: row.day, code, amount: overRefund(row) } : null;
    }, true),
    ...outcomesFor("recon.gst_lines", dates, read.gstLines, (row) => {
      const code = gstLinesBreak(row, read.basis);
      // dec-9 (how a credit note restates the order's GST) is the open decision
      // behind the one exclusion, so it explains it: shown and counted, not an alarm.
      return code ? { day: row.day, code, explainedBy: code === "NOT_CHECKED_REFUNDED" ? "dec-9" : null } : null;
    }, false),
    ...outcomesFor("recon.loyalty_refund", dates, read.loyaltyRefunds, (row) =>
      loyaltyStillHeld(row) ? { day: row.day, code: row.stampHeld ? "STAMP_HELD" : "POINTS_HELD" } : null,
    false),
  );

  // Invoices: per-order checks on each day, plus the year's sequence on the run's day.
  const perOrder = outcomesFor("recon.invoice", dates, read.invoices, (row) => {
    const code = invoiceBreak(row);
    return code ? { day: row.day, code } : null;
  }, false);
  if (read.invoiceNumbers.status === "timeout") {
    outcomes.push(...perOrder.map((o): ReconOutcome => (o.date === date ? { ruleId: "recon.invoice", date, status: "NOT_EVALUATED", reason: "rule_timeout" } : o)));
  } else {
    const year = financialYear(new Date(`${date}T12:00:00+05:30`));
    const { gaps, duplicates } = invoiceSequenceBreaks(read.invoiceNumbers.rows, year);
    outcomes.push(
      ...perOrder.map((o): ReconOutcome => {
        if (o.date !== date || gaps + duplicates === 0 || o.status === "NOT_EVALUATED") return o;
        const base = o.status === "FIRED" ? o : { unexplained: 0, breaks: {} as Record<string, number> };
        const breaks: Record<string, number> = { ...base.breaks };
        if (gaps > 0) breaks.FY_GAP = gaps;
        if (duplicates > 0) breaks.FY_DUPLICATE = duplicates;
        return { ruleId: "recon.invoice", date, status: "FIRED", unexplained: base.unexplained + gaps + duplicates, explained: 0, explainedBy: null, amount: null, breaks };
      }),
    );
  }

  // Facts parity, per day.
  if (read.parity.status === "timeout") {
    outcomes.push(...dates.map((d): ReconOutcome => ({ ruleId: "recon.facts_parity", date: d, status: "NOT_EVALUATED", reason: "rule_timeout" })));
  } else {
    const byDate = new Map(read.parity.rows.map((p) => [p.date, p]));
    for (const d of dates) {
      const day = byDate.get(d);
      if (!day || !day.checked) outcomes.push({ ruleId: "recon.facts_parity", date: d, status: "NOT_EVALUATED", reason: day?.notCheckedReason ?? "facts_not_computed" });
      else if (day.mismatchedMetrics.length === 0) outcomes.push({ ruleId: "recon.facts_parity", date: d, status: "CLEAR" });
      else {
        const breaks: Record<string, number> = {};
        for (const metric of day.mismatchedMetrics) breaks[metric] = 1;
        outcomes.push({ ruleId: "recon.facts_parity", date: d, status: "FIRED", unexplained: day.mismatchedMetrics.length, explained: 0, explainedBy: null, amount: null, breaks });
      }
    }
  }
  return outcomes;
}
