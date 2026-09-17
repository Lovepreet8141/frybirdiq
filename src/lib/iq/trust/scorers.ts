/**
 * Data-trust scorers — IQ-1 slice S7. hive/reviews/iq-1/DESIGN.md "Trust
 * signals"; REVIEW.md required change 3 (T6 marks D3 days LOW) and I2
 * (metric trust = lowest signal grade, limiting signal named).
 *
 * Pure: counts in, grade out. Each scorer takes the numerator and denominator
 * a repository counted for one org and one IST business day, and returns the
 * grade stored in `iq_daily_trust`. A denominator of zero means there was
 * nothing to measure, which is UNKNOWN, never HIGH.
 *
 * Thresholds are the design's proposals, pending RESTAURANT-OPS review. Where
 * the design gives no MEDIUM band (T5, T6) any failure is LOW. Where it names
 * two conditions and no band (T7), both met is HIGH and one is MEDIUM.
 */

import { type TrustSignalId, getDerivedMetric, getMetric, isDerivedMetricId, type AnyMetricId } from "@/lib/iq/metrics";

export const TRUST_GRADES = ["HIGH", "MEDIUM", "LOW", "UNKNOWN"] as const;
export type TrustGrade = (typeof TRUST_GRADES)[number];

/**
 * Worst first. LOW (known bad) is below UNKNOWN (not measured), and UNKNOWN is
 * below MEDIUM: a figure resting on something nobody checked cannot be rated
 * better than one that was checked and found middling.
 */
const RANK: Readonly<Record<TrustGrade, number>> = { LOW: 0, UNKNOWN: 1, MEDIUM: 2, HIGH: 3 };

export function gradeRank(grade: TrustGrade): number {
  return RANK[grade];
}

export interface SignalScore {
  readonly signalId: TrustSignalId;
  readonly numerator: bigint;
  readonly denominator: bigint;
  readonly grade: TrustGrade;
  /** Counts only — no names, ids or amounts that identify a person. */
  readonly detail: Readonly<Record<string, number>>;
}

function assertCounts(numerator: bigint, denominator: bigint): void {
  if (numerator < 0n || denominator < 0n || numerator > denominator) {
    throw new RangeError(`trust: ${numerator}/${denominator} is not a share`);
  }
}

/** numerator / denominator ≥ thresholdBps / 10 000, exactly, in integers. */
function atLeast(numerator: bigint, denominator: bigint, thresholdBps: bigint): boolean {
  return numerator * 10_000n >= denominator * thresholdBps;
}

/** A share graded HIGH at ≥ highBps, MEDIUM at ≥ mediumBps, LOW below; UNKNOWN with nothing measured. */
function shareGrade(numerator: bigint, denominator: bigint, highBps: bigint, mediumBps: bigint): TrustGrade {
  assertCounts(numerator, denominator);
  if (denominator === 0n) return "UNKNOWN";
  if (atLeast(numerator, denominator, highBps)) return "HIGH";
  if (atLeast(numerator, denominator, mediumBps)) return "MEDIUM";
  return "LOW";
}

/** T1 recipe coverage: net line value (paise) of sold lines whose product has a costed recipe ÷ all. ≥90% HIGH, 70–90% MEDIUM. */
export function gradeRecipeCoverage(coveredPaise: bigint, totalPaise: bigint): TrustGrade {
  return shareGrade(coveredPaise, totalPaise, 9_000n, 7_000n);
}

/** T1b costed SALE movements ÷ all SALE movements. ≥98% HIGH, ≥90% MEDIUM. */
export function gradeCostedSaleRows(costed: bigint, total: bigint): TrustGrade {
  return shareGrade(costed, total, 9_800n, 9_000n);
}

/** Days a price stays fresh for T2. */
export const PRICE_FRESHNESS_DAYS = 14;

/** T2 usage (weighted) priced within PRICE_FRESHNESS_DAYS ÷ all usage. ≥80% HIGH, ≥50% MEDIUM. */
export function gradePriceFreshness(freshWeight: bigint, totalWeight: bigint): TrustGrade {
  return shareGrade(freshWeight, totalWeight, 8_000n, 5_000n);
}

/** T3 stock count recency. UNKNOWN until matching stock counts are recorded (D17, S4). */
export function gradeStockCountRecency(): TrustGrade {
  return "UNKNOWN";
}

/** Days in the T4 window, ending on the business date. */
export const WASTE_WINDOW_DAYS = 7;

/**
 * T4 sales days with waste logged ÷ sales days, in the 7 days ending on the
 * date. ≥5 of 7 HIGH, 3–4 of 7 MEDIUM; with fewer sales days the same share
 * applies (5/7, 3/7).
 */
export function gradeWasteLogging(loggedDays: bigint, salesDays: bigint): TrustGrade {
  assertCounts(loggedDays, salesDays);
  if (salesDays === 0n) return "UNKNOWN";
  if (loggedDays * 7n >= salesDays * 5n) return "HIGH";
  if (loggedDays * 7n >= salesDays * 3n) return "MEDIUM";
  return "LOW";
}

/** App clock vs database clock beyond this is a T5 failure. */
export const CLOCK_SKEW_LIMIT_MS = 5_000;
/** placed_at vs created_at beyond this is a T5 failure. */
export const PLACED_DRIFT_LIMIT_MS = 120_000;
/**
 * A business_date one day off created_at is honest within this of IST
 * midnight: the app clock may lag the database by CLOCK_SKEW_LIMIT_MS and a
 * request may take up to PLACED_DRIFT_LIMIT_MS between the two stamps.
 */
export const MIDNIGHT_TOLERANCE_MS = CLOCK_SKEW_LIMIT_MS + PLACED_DRIFT_LIMIT_MS;

/**
 * T5 clock and timezone sanity: rows that pass ÷ rows checked, with org-level
 * checks (timezone setting, app vs DB clock) applied to today only. Any
 * failure is LOW. Nothing checked and org checks pass is UNKNOWN.
 */
export function gradeClockSanity(cleanRows: bigint, checkedRows: bigint, orgChecksPass: boolean): TrustGrade {
  assertCounts(cleanRows, checkedRows);
  if (!orgChecksPass) return "LOW";
  if (checkedRows === 0n) return "UNKNOWN";
  return cleanRows === checkedRows ? "HIGH" : "LOW";
}

/**
 * T6 payment integrity: orders without an anomaly ÷ orders checked. Any
 * anomaly — more than one CAPTURED payment (D3), a partial refund, a
 * cancelled order with a capture and no refund, a FAILED order with a
 * capture, captured ≠ grand total — is LOW (REVIEW required change 3). After
 * dec-9 a partial refund may stop being a defect.
 */
export function gradePaymentIntegrity(cleanOrders: bigint, checkedOrders: bigint): TrustGrade {
  assertCounts(cleanOrders, checkedOrders);
  if (checkedOrders === 0n) return "UNKNOWN";
  return cleanOrders === checkedOrders ? "HIGH" : "LOW";
}

/** T7 cost recording: a DIRECT expense in the month so far and one within the last 7 days. Both HIGH, the month only MEDIUM, neither LOW. */
export function gradeCostRecording(inMonth: boolean, withinSevenDays: boolean): TrustGrade {
  if (inMonth && withinSevenDays) return "HIGH";
  if (inMonth) return "MEDIUM";
  return "LOW";
}

export interface MetricTrust {
  readonly grade: TrustGrade;
  /** The signal holding the grade down, first in catalog order among ties; null when nothing limits it. */
  readonly limitingSignal: TrustSignalId | null;
  readonly signals: readonly { readonly signalId: TrustSignalId; readonly grade: TrustGrade }[];
}

/**
 * A metric's trust is the lowest grade among its signals (I2), naming the
 * signal that sets it. A metric with no signals has nothing vouching for it:
 * UNKNOWN, no limiting signal. A signal missing from `grades` is UNKNOWN.
 */
export function metricTrust(metricId: AnyMetricId, grades: Readonly<Partial<Record<TrustSignalId, TrustGrade>>>): MetricTrust {
  const definition = isDerivedMetricId(metricId) ? getDerivedMetric(metricId) : getMetric(metricId);
  const signals = definition.trustSignals.map((signalId) => ({ signalId, grade: grades[signalId] ?? "UNKNOWN" }));
  if (signals.length === 0) return { grade: "UNKNOWN", limitingSignal: null, signals };
  let limiting = signals[0]!;
  for (const signal of signals) if (RANK[signal.grade] < RANK[limiting.grade]) limiting = signal;
  return { grade: limiting.grade, limitingSignal: limiting.grade === "HIGH" ? null : limiting.signalId, signals };
}

/** The worse of two grades. */
export function lowerGrade(a: TrustGrade, b: TrustGrade): TrustGrade {
  return RANK[a] <= RANK[b] ? a : b;
}
