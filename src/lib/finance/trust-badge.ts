/**
 * The trust badge beside a P&L figure (IQ-1 S9, review I2).
 *
 * A figure read from the daily facts carries its metric's trust: the lowest
 * grade among the signals it rests on, naming the signal that sets it and the
 * day it came from, so the owner can see *why* a number is shaky rather than
 * only that it is. Pure: grade in, words and a tone out. The component maps
 * the tone to a colour; nothing here formats money.
 */

import type { TrustSignalId } from "@/lib/iq/metrics";
import type { TrustGrade } from "@/lib/iq/trust";

/** Owner-facing names for the trust signals — what was checked, in plain words. */
export const TRUST_SIGNAL_LABELS: Readonly<Record<TrustSignalId, string>> = {
  t1_recipe_coverage: "recipe coverage",
  t1b_costed_sale_rows: "costed sales",
  t2_price_freshness: "ingredient price freshness",
  t3_stock_count_recency: "stock counts",
  t4_waste_logging: "waste logging",
  t5_clock_sanity: "clock and time-zone checks",
  t6_payment_integrity: "payment integrity",
  t7_cost_recording: "cost recording",
};

export type TrustBadgeTone = "gain" | "flag" | "loss" | "neutral";

export interface TrustBadge {
  readonly tone: TrustBadgeTone;
  readonly text: string;
}

/** What `getMetricTrust` returns, narrowed to what a badge reads. */
export interface TrustForBadge {
  readonly grade: TrustGrade;
  readonly limitingSignal: TrustSignalId | null;
  /** IST business date "YYYY-MM-DD" the limiting grade comes from. */
  readonly limitingDate: string | null;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

function dayMonth(date: string): string {
  const [, month, day] = date.split("-").map(Number) as [number, number, number];
  return `${day} ${MONTHS[month - 1] ?? ""}`.trim();
}

const GRADE_WORDS: Readonly<Record<TrustGrade, { tone: TrustBadgeTone; words: string }>> = {
  HIGH: { tone: "gain", words: "high trust" },
  MEDIUM: { tone: "flag", words: "medium trust" },
  LOW: { tone: "loss", words: "low trust" },
  UNKNOWN: { tone: "neutral", words: "trust not checked" },
};

/**
 * "Net profit: low trust — payment integrity, 3 Sep". HIGH names nothing;
 * any other grade names its limiting signal and day when it has them.
 */
export function trustBadge(label: string, trust: TrustForBadge): TrustBadge {
  const { tone, words } = GRADE_WORDS[trust.grade];
  if (trust.grade === "HIGH" || trust.limitingSignal === null) return { tone, text: `${label}: ${words}` };
  const why = TRUST_SIGNAL_LABELS[trust.limitingSignal];
  const when = trust.limitingDate === null ? "" : `, ${dayMonth(trust.limitingDate)}`;
  return { tone, text: `${label}: ${words} — ${why}${when}` };
}
