/**
 * What the daily brief's FACTs are made of — pure, so the repository around it
 * does only the org-scoped reads (the ARCHITECT ruling on 56fc9ba: one source
 * for a figure and its trust, never two derivations of the same number).
 *
 * The brief cites five figures for the day and net sales over two month spans
 * (BUSINESS-INTELLIGENCE's `BriefFiguresRead`, iq2-s10). Four of the five day
 * figures are the detectors' own, so they come from `detectDayFrom` and keep
 * exactly the values and trust the detectors saw. The fifth, net_collected, and
 * the two spans are sums the detectors do not carry, so they are derived here
 * from the same summed facts and the same stored trust rows.
 *
 * Trust over a span is the worst grade any day in it scored, which is the rule
 * the day figures already use, applied across days: a month whose first week
 * was LOW is not reported as HIGH. A span with no computed day has no figure at
 * all — the brief drops the line rather than printing a zero.
 */
import type { DayFacts, DayTrustRow } from "@/lib/iq/detect/day";
import { detectDayFrom } from "@/lib/iq/detect/day";
import type { DetectFigureId } from "@/lib/iq/detect/rules";
import type { FigureTrust, Observed, Quantity } from "@/lib/iq/engine";
import { istTimestamp } from "@/lib/iq/detect/detect-job";
import type { BriefFigure, BriefFiguresRead } from "@/lib/iq/brief/brief-job";
import type { BriefDayMetric } from "@/lib/iq/brief/templates";
import { type TrustGrade, lowerGrade, metricTrust } from "@/lib/iq/trust";
import type { TrustSignalId } from "@/lib/iq/metrics";

/** The day metrics the detectors already derive; net_collected is not one of them. */
const FROM_DETECT_DAY = ["revenue_net", "orders_paid", "aov_net", "food_cost_pct_theoretical"] as const satisfies readonly (BriefDayMetric & DetectFigureId)[];

/**
 * One date's reads, as the repository fetched them. `netCollected` comes in
 * already computed: it is money arithmetic (Σ captured − Σ refunds, F8), which
 * belongs to src/lib/money through the metrics catalog's own helper, and this
 * module holds no money type. Null when the day has no captures or refunds.
 */
export type BriefDayRead = {
  readonly date: string;
  readonly facts: DayFacts;
  readonly trust: readonly DayTrustRow[];
  readonly netCollected: bigint | null;
};

/** A whole span's reads: the summed facts over it, and every trust row of every day in it. */
export type BriefSpanRead = {
  /** True when at least one day in the span has computed facts. */
  readonly computed: boolean;
  /** Σ over the span, by metric. */
  readonly totals: DayFacts["totals"];
  /** Every day's rows; the span's grade is the worst of them. */
  readonly trust: readonly DayTrustRow[];
};

/** The worst grade each signal reached anywhere in the span, with the latest computedAt. */
function spanTrust(metricId: "revenue_net" | "net_collected", rows: readonly DayTrustRow[]): FigureTrust | null {
  if (rows.length === 0) return null;
  // Per signal, the row holding the worst grade: its own stored ratio, never a sum across days.
  const worst = new Map<TrustSignalId, DayTrustRow>();
  for (const row of rows) {
    const held = worst.get(row.signalId);
    if (held === undefined || lowerGrade(row.grade, held.grade) === row.grade) worst.set(row.signalId, row);
  }
  const grades: Partial<Record<TrustSignalId, TrustGrade>> = {};
  for (const [signalId, row] of worst) grades[signalId] = row.grade;

  const trust = metricTrust(metricId, grades);
  const signalId = trust.limitingSignal ?? weakestScored(trust.signals);
  const ratio = signalId === null ? null : (worst.get(signalId) ?? null);
  return {
    grade: trust.grade,
    signalId,
    ratio: ratio === null || ratio.denominator === 0n ? null : { numerator: ratio.numerator, denominator: ratio.denominator },
    asOf: istTimestamp(new Date(Math.max(...rows.map((row) => row.computedAt.getTime())))),
  };
}

/** At HIGH no signal limits the figure, so the weakest scored one carries the ratio (engine's rule). */
function weakestScored(signals: readonly { readonly signalId: TrustSignalId; readonly grade: TrustGrade }[]): TrustSignalId | null {
  let weakest: { readonly signalId: TrustSignalId; readonly grade: TrustGrade } | null = null;
  for (const signal of signals) {
    if (signal.grade === "UNKNOWN") continue;
    if (weakest === null || lowerGrade(signal.grade, weakest.grade) === signal.grade) weakest = signal;
  }
  return weakest?.signalId ?? null;
}

function spanFigure(read: BriefSpanRead, observe: (q: Quantity) => Observed): BriefFigure | null {
  if (!read.computed) return null;
  const trust = spanTrust("revenue_net", read.trust);
  if (trust === null) return null;
  return { value: observe({ unit: "paise", value: (read.totals.revenue_net ?? 0n).toString() }), trust };
}

/**
 * Builds the brief's figures from one day's reads and the two spans'.
 * `observe` mints the Observed quantities (only a repository may).
 */
export function briefFiguresFrom(
  day: BriefDayRead,
  monthToDate: BriefSpanRead,
  sameDaysLastMonth: BriefSpanRead,
  observe: (q: Quantity) => Observed,
): BriefFiguresRead {
  const detect = detectDayFrom(day.date, day.facts, day.trust, observe);
  const figures: Partial<Record<BriefDayMetric, BriefFigure>> = {};
  for (const id of FROM_DETECT_DAY) {
    const value = detect.figures[id];
    const trust = detect.trust[id];
    if (value && trust) figures[id] = { value, trust: { grade: trust.grade, signalId: trust.signalId, ratio: trust.ratio, asOf: trust.asOf } };
  }

  // net_collected is not a detector figure: captured minus refunds, GST included (F8).
  if (day.facts.computed && day.netCollected !== null) {
    const trust = spanTrust("net_collected", day.trust);
    if (trust !== null) figures.net_collected = { value: observe({ unit: "paise", value: day.netCollected.toString() }), trust };
  }

  return { day: figures, monthToDate: spanFigure(monthToDate, observe), sameDaysLastMonth: spanFigure(sameDaysLastMonth, observe) };
}
