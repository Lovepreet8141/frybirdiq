/**
 * The IQ-2 baseline detector rules and their pure evaluation for one day.
 *
 * hive/reviews/iq-2/DESIGN.md §2, with Revision 2 (R2.4 not-evaluated → no
 * expire, R2.9 waste floor ₹1,000 and owner-excluded dates, R2.11 S3 row).
 *
 * Input figures arrive already Observed — minted by the repository reader
 * that summed the stored facts (and derived AOV and shares from those sums).
 * This module compares; it never mints a figure from a number.
 *
 * Every rule ends in exactly one of:
 * - FIRED: a detection to write (severity capped at 1 on LOW/UNKNOWN trust);
 * - CLEAR: evaluated on trusted data and silent → an existing insight may expire;
 * - NOT_EVALUATED: anything else (closed day, owner-excluded date, parity
 *   flag, missing figure or trust, fewer than 4 points, zero median, LOW or
 *   UNKNOWN trust while silent, no target) → an existing insight is left alone.
 */
import { addDays } from "@/lib/dates";
import {
  CAPPED_LOW_TRUST,
  magnitudeOf,
  observedMedian,
  observedShare,
  trustGate,
  type FigureTrust,
  type Observed,
} from "@/lib/iq/engine";

import { BASELINE_WEEKS, UNIT_FLOOR, baselineDates, baselineStats, deviationBps, zAtLeast, zAtMost, type BaselineStats, type FigureUnit } from "./baseline";

export const DETECT_RULES_VERSION = 1;

/** What the rules read for a day. Each is one Observed figure; `FIGURE_INPUTS` names its stored metrics. */
export const DETECT_FIGURES = [
  "revenue_net",
  "orders_paid",
  "aov_net",
  "discount_share",
  "orders_cancelled_failed",
  "refunds_amount",
  "sales_gross",
  "waste_cost",
  "food_cost_pct_theoretical",
  "online_share",
] as const;
export type DetectFigureId = (typeof DETECT_FIGURES)[number];

export const FIGURE_UNITS: Readonly<Record<DetectFigureId, FigureUnit>> = {
  revenue_net: "paise",
  orders_paid: "count",
  aov_net: "paise",
  discount_share: "bps",
  orders_cancelled_failed: "count",
  refunds_amount: "paise",
  sales_gross: "paise",
  waste_cost: "paise",
  food_cost_pct_theoretical: "bps",
  online_share: "bps",
};

/**
 * The σ floor per figure (RESTAURANT-OPS iq2-s3r-ops, god's fix batch iq2-s3b).
 * Floors are set per metric so the rule-level floors actually bind:
 * - revenue ₹500: the right noise scale for a single QSR's daily sales;
 * - average order ₹10: the 15% deviation bound, not the floor, gates aov.shift;
 * - waste ₹150: 3σ = ₹450, below the ₹1,000 rule floor, so that floor decides;
 * - order counts 1: 3σ = 3 orders, so orders' "drop ≥ 5" and cancellations' "+3" decide.
 * 5% of the median still applies when it is larger.
 */
export const FIGURE_SIGMA_FLOOR: Readonly<Record<DetectFigureId, bigint>> = {
  revenue_net: UNIT_FLOOR.paise,
  orders_paid: 1n,
  aov_net: 1000n,
  discount_share: UNIT_FLOOR.bps,
  orders_cancelled_failed: 1n,
  refunds_amount: UNIT_FLOOR.paise,
  sales_gross: UNIT_FLOOR.paise,
  waste_cost: 15000n,
  food_cost_pct_theoretical: UNIT_FLOOR.bps,
  online_share: UNIT_FLOOR.bps,
};

/** How each figure is built from stored facts, and which metrics its trust rests on: `FIGURE_INPUTS` in ./day.ts. */

/** A figure's trust for a day, plus how many of its signals were LOW (read from iq_daily_trust). */
export type DetectTrust = FigureTrust & { readonly lowSignals: Observed };

export type DetectDay = {
  readonly date: string;
  /** False when the facts job never computed this day. */
  readonly hasFacts: boolean;
  /** True when facts parity flagged this day. */
  readonly parityFlagged: boolean;
  readonly figures: Readonly<Partial<Record<DetectFigureId, Observed>>>;
  readonly trust: Readonly<Partial<Record<DetectFigureId, DetectTrust>>>;
};

export type NotEvaluatedReason =
  | "no_facts"
  | "closed_day"
  | "excluded_date"
  | "parity_flagged"
  | "figure_missing"
  | "no_trust"
  | "insufficient_history"
  | "zero_median"
  | "low_trust"
  | "no_target"
  | "previous_trust_unknown";

export type Baseline = {
  readonly method: "median_mad" | "threshold";
  readonly value: Observed;
  readonly windowWeeks: number;
};

export type RuleOutcome =
  | {
      readonly status: "FIRED";
      readonly ruleId: string;
      readonly figure: DetectFigureId;
      readonly dedupeKey: string;
      readonly severity: 1 | 2 | 3;
      /** Severity was capped to 1 because the figure's trust is LOW or UNKNOWN. */
      readonly capped: boolean;
      readonly observed: Observed;
      readonly baseline: Baseline;
      readonly deviationBps: number;
      readonly trust: DetectTrust;
      readonly trustReasons: readonly string[];
      /** Baseline days actually used (empty for threshold rules). */
      readonly pointDates: readonly string[];
    }
  | { readonly status: "CLEAR"; readonly ruleId: string; readonly figure: DetectFigureId; readonly dedupeKey: string }
  | {
      readonly status: "NOT_EVALUATED";
      readonly ruleId: string;
      readonly figure: DetectFigureId;
      readonly dedupeKey: string;
      readonly reason: NotEvaluatedReason;
    };

type Severity = 0 | 1 | 2 | 3;

type BaselineCheck = {
  readonly x: bigint;
  readonly stats: BaselineStats;
  /** Relative change in bps, null when the median is not positive. */
  readonly dev: number | null;
  /** x − median, in the figure's unit. */
  readonly delta: bigint;
};

type BaselineRule = {
  readonly ruleId: string;
  readonly figure: DetectFigureId;
  /** Relative-change rules cannot evaluate on a zero median. */
  readonly needsPositiveMedian: boolean;
  readonly severity: (c: BaselineCheck) => Severity;
};

const either = (c: BaselineCheck, k: number) => zAtLeast(c.x, c.stats, k) || zAtMost(c.x, c.stats, -k);

/** §2 table. Thresholds are review-agreed proposals (REVIEW-RESTAURANT-OPS.md O1; waste floor per R2.9). */
export const BASELINE_RULES: readonly BaselineRule[] = [
  {
    ruleId: "sales.below_weekday_baseline",
    figure: "revenue_net",
    needsPositiveMedian: true,
    severity: (c) => (zAtMost(c.x, c.stats, -4) && c.dev! <= -4000 ? 3 : zAtMost(c.x, c.stats, -3) && c.dev! <= -2500 ? 2 : 0),
  },
  {
    ruleId: "sales.above_weekday_baseline",
    figure: "revenue_net",
    needsPositiveMedian: true,
    severity: (c) => (zAtLeast(c.x, c.stats, 3) && c.dev! >= 3000 ? 1 : 0),
  },
  {
    ruleId: "orders.below_weekday_baseline",
    figure: "orders_paid",
    needsPositiveMedian: true,
    severity: (c) => (zAtMost(c.x, c.stats, -3) && c.dev! <= -2500 && -c.delta >= 5n ? 2 : 0),
  },
  {
    ruleId: "aov.shift",
    figure: "aov_net",
    needsPositiveMedian: true,
    severity: (c) => (either(c, 3) && Math.abs(c.dev!) >= 1500 ? 1 : 0),
  },
  {
    ruleId: "discount.spike",
    figure: "discount_share",
    needsPositiveMedian: false,
    severity: (c) => (zAtLeast(c.x, c.stats, 3) && c.delta >= 500n ? 2 : 0),
  },
  {
    ruleId: "cancellations.spike",
    figure: "orders_cancelled_failed",
    needsPositiveMedian: false,
    severity: (c) => (zAtLeast(c.x, c.stats, 3) && c.delta >= 3n ? 2 : 0),
  },
  {
    ruleId: "waste.spike",
    figure: "waste_cost",
    needsPositiveMedian: false,
    severity: (c) => (zAtLeast(c.x, c.stats, 3) && c.delta >= WASTE_FLOOR_PAISE ? 2 : 0),
  },
  {
    ruleId: "food_cost.above_baseline",
    figure: "food_cost_pct_theoretical",
    needsPositiveMedian: false,
    severity: (c) => (zAtLeast(c.x, c.stats, 3) && c.delta >= 300n ? 2 : 0),
  },
  {
    ruleId: "channel_mix.shift",
    figure: "online_share",
    needsPositiveMedian: false,
    severity: (c) => (either(c, 3) && (c.delta >= 1500n || c.delta <= -1500n) ? 1 : 0),
  },
];

/** ₹1,000 — god's decision on RESTAURANT-OPS O1 (R2.9). */
export const WASTE_FLOOR_PAISE = 100000n;
/**
 * refunds.spike: refunds above 2% of gross sales, severity 2 (god's ruling on iq2-s3b).
 * Gross against gross: refunds_amount includes GST, so it is compared with sales_gross, not
 * revenue_net (ANALYTICS-DATA iq2-s3r-ad C1).
 *
 * TODO(an-1): add the count arm, severity 1 for 2+ refunds on the day, once ANALYTICS-DATA adds a
 * refunds_count fact anchored on the refund's day. The existing refunded-order counts are anchored
 * on the order's day and count a refunded double capture, so they cannot be used (C2).
 */
export const REFUND_SHARE_BPS = 200n;
/** food_cost.above_target: at or above the owner's target + 2 percentage points (dec-7). */
export const FOOD_COST_TARGET_MARGIN_BPS = 200n;

export function dedupeKeyFor(ruleId: string, date: string, figure?: DetectFigureId): string {
  return figure ? `detect:${ruleId}:${figure}:${date}` : `detect:${ruleId}:${date}`;
}

export type DetectDayInput = {
  /** The IST business day evaluated (the job's D-1). */
  readonly date: string;
  /** That day, the day before it, and its baseline days; missing days count as no facts. */
  readonly days: readonly DetectDay[];
  /** Owner-supplied closure / reduced-hours dates. Empty unless the owner provided them (R2.9). */
  readonly excludedDates?: readonly string[];
  /** The owner's food-cost target for the day's month, read from a stored row; null until dec-7. */
  readonly foodCostTarget?: Observed | null;
};

export type DetectEvaluation = {
  readonly outcomes: readonly RuleOutcome[];
  readonly summary: Readonly<Record<string, number>>;
};

function checkUnit(figure: DetectFigureId, q: Observed): void {
  const expected = FIGURE_UNITS[figure];
  if (q.unit !== expected) throw new TypeError(`detect: ${figure} must be ${expected}, got ${q.unit}`);
}

function isClosed(day: DetectDay): boolean {
  const orders = day.figures.orders_paid;
  return day.hasFacts && orders !== undefined && magnitudeOf(orders) === 0n;
}

/** Why a whole day cannot be evaluated or used, or null when it can. */
function dayGate(day: DetectDay | undefined, excluded: ReadonlySet<string>, date: string): NotEvaluatedReason | null {
  if (excluded.has(date)) return "excluded_date";
  if (!day || !day.hasFacts) return "no_facts";
  if (isClosed(day)) return "closed_day";
  if (day.parityFlagged) return "parity_flagged";
  return null;
}

function definedDeviation(dev: number | null, delta: bigint): number {
  if (dev !== null) return dev;
  return delta > 0n ? 10000 : delta < 0n ? -10000 : 0;
}

function gated(severity: Severity, trust: DetectTrust) {
  const decision = trustGate(trust.grade, "DETECTION");
  const capped = decision === "PUBLISH_CAPPED";
  return {
    capped,
    severity: (capped && severity > 1 ? 1 : severity) as Severity,
    silentReason: capped ? ("low_trust" as const) : null,
    reasons: capped ? [CAPPED_LOW_TRUST] : [],
  };
}

export function evaluateDetectDay(input: DetectDayInput): DetectEvaluation {
  const byDate = new Map(input.days.map((d) => [d.date, d]));
  const excluded = new Set(input.excludedDates ?? []);
  const today = byDate.get(input.date);
  const todayGate = dayGate(today, excluded, input.date);
  const outcomes: RuleOutcome[] = [];

  const notEvaluated = (ruleId: string, figure: DetectFigureId, reason: NotEvaluatedReason, dedupeKey = dedupeKeyFor(ruleId, input.date)) =>
    outcomes.push({ status: "NOT_EVALUATED", ruleId, figure, dedupeKey, reason });

  for (const rule of BASELINE_RULES) {
    const dedupeKey = dedupeKeyFor(rule.ruleId, input.date);
    if (todayGate) {
      notEvaluated(rule.ruleId, rule.figure, todayGate);
      continue;
    }
    const x = today!.figures[rule.figure];
    const trust = today!.trust[rule.figure];
    if (!x) {
      notEvaluated(rule.ruleId, rule.figure, "figure_missing");
      continue;
    }
    checkUnit(rule.figure, x);
    if (!trust) {
      notEvaluated(rule.ruleId, rule.figure, "no_trust");
      continue;
    }

    const pointDates: string[] = [];
    const points: Observed[] = [];
    for (const date of baselineDates(input.date)) {
      const day = byDate.get(date);
      if (dayGate(day, excluded, date)) continue;
      const value = day!.figures[rule.figure];
      if (!value || day!.trust[rule.figure]?.grade === "LOW") continue;
      checkUnit(rule.figure, value);
      points.push(value);
      pointDates.push(date);
    }
    const stats = baselineStats(points.map(magnitudeOf), FIGURE_SIGMA_FLOOR[rule.figure]);
    if (!stats) {
      notEvaluated(rule.ruleId, rule.figure, "insufficient_history");
      continue;
    }
    if (rule.needsPositiveMedian && stats.median <= 0n) {
      notEvaluated(rule.ruleId, rule.figure, "zero_median");
      continue;
    }

    const xv = magnitudeOf(x);
    const check: BaselineCheck = { x: xv, stats, dev: deviationBps(xv, stats.median), delta: xv - stats.median };
    const g = gated(rule.severity(check), trust);
    if (g.severity === 0) {
      if (g.silentReason) notEvaluated(rule.ruleId, rule.figure, g.silentReason);
      else outcomes.push({ status: "CLEAR", ruleId: rule.ruleId, figure: rule.figure, dedupeKey });
      continue;
    }
    outcomes.push({
      status: "FIRED",
      ruleId: rule.ruleId,
      figure: rule.figure,
      dedupeKey,
      severity: g.severity as 1 | 2 | 3,
      capped: g.capped,
      observed: x,
      baseline: { method: "median_mad", value: observedMedian(points), windowWeeks: BASELINE_WEEKS },
      deviationBps: definedDeviation(check.dev, check.delta),
      trust,
      trustReasons: g.reasons,
      pointDates,
    });
  }

  evaluateRefunds(input.date, today, todayGate, outcomes);
  evaluateFoodCostTarget(input.date, today, todayGate, input.foodCostTarget ?? null, outcomes);
  evaluateTrustDrops(input.date, today, byDate.get(addDays(input.date, -1)), todayGate, outcomes);

  return { outcomes, summary: summarize(outcomes) };
}

function evaluateRefunds(date: string, today: DetectDay | undefined, todayGate: NotEvaluatedReason | null, outcomes: RuleOutcome[]): void {
  const ruleId = "refunds.spike";
  const figure: DetectFigureId = "refunds_amount";
  const dedupeKey = dedupeKeyFor(ruleId, date);
  const skip = (reason: NotEvaluatedReason) => outcomes.push({ status: "NOT_EVALUATED", ruleId, figure, dedupeKey, reason });
  if (todayGate) return void skip(todayGate);
  const amount = today!.figures.refunds_amount;
  const gross = today!.figures.sales_gross;
  const trust = today!.trust.refunds_amount;
  if (!amount || !gross) return void skip("figure_missing");
  checkUnit("refunds_amount", amount);
  checkUnit("sales_gross", gross);
  if (!trust) return void skip("no_trust");

  const threshold = observedShare(gross, REFUND_SHARE_BPS);
  const a = magnitudeOf(amount);
  const t = magnitudeOf(threshold);
  const severity: Severity = a > 0n && a * 10000n > REFUND_SHARE_BPS * magnitudeOf(gross) ? 2 : 0;
  const g = gated(severity, trust);
  if (g.severity === 0) {
    if (g.silentReason) skip(g.silentReason);
    else outcomes.push({ status: "CLEAR", ruleId, figure, dedupeKey });
    return;
  }
  outcomes.push({
    status: "FIRED",
    ruleId,
    figure,
    dedupeKey,
    severity: g.severity as 1 | 2 | 3,
    capped: g.capped,
    observed: amount,
    baseline: { method: "threshold", value: threshold, windowWeeks: 0 },
    deviationBps: definedDeviation(deviationBps(a, t), a - t),
    trust,
    trustReasons: g.reasons,
    pointDates: [],
  });
}

function evaluateFoodCostTarget(
  date: string,
  today: DetectDay | undefined,
  todayGate: NotEvaluatedReason | null,
  target: Observed | null,
  outcomes: RuleOutcome[],
): void {
  const ruleId = "food_cost.above_target";
  const figure: DetectFigureId = "food_cost_pct_theoretical";
  const dedupeKey = dedupeKeyFor(ruleId, date);
  const skip = (reason: NotEvaluatedReason) => outcomes.push({ status: "NOT_EVALUATED", ruleId, figure, dedupeKey, reason });
  if (todayGate) return void skip(todayGate);
  if (!target) return void skip("no_target");
  checkUnit(figure, target);
  const x = today!.figures[figure];
  const trust = today!.trust[figure];
  if (!x) return void skip("figure_missing");
  checkUnit(figure, x);
  if (!trust) return void skip("no_trust");

  const xv = magnitudeOf(x);
  const tv = magnitudeOf(target);
  const g = gated(xv >= tv + FOOD_COST_TARGET_MARGIN_BPS ? 2 : 0, trust);
  if (g.severity === 0) {
    if (g.silentReason) skip(g.silentReason);
    else outcomes.push({ status: "CLEAR", ruleId, figure, dedupeKey });
    return;
  }
  outcomes.push({
    status: "FIRED",
    ruleId,
    figure,
    dedupeKey,
    severity: g.severity as 1 | 2 | 3,
    capped: g.capped,
    observed: x,
    baseline: { method: "threshold", value: target, windowWeeks: 0 },
    deviationBps: definedDeviation(deviationBps(xv, tv), xv - tv),
    trust,
    trustReasons: g.reasons,
    pointDates: [],
  });
}

/** trust.grade_dropped: the figure's trust is LOW today and was HIGH or MEDIUM the day before. Never trust-gated. */
function evaluateTrustDrops(
  date: string,
  today: DetectDay | undefined,
  yesterday: DetectDay | undefined,
  todayGate: NotEvaluatedReason | null,
  outcomes: RuleOutcome[],
): void {
  const ruleId = "trust.grade_dropped";
  for (const figure of DETECT_FIGURES) {
    const dedupeKey = dedupeKeyFor(ruleId, date, figure);
    const skip = (reason: NotEvaluatedReason) => outcomes.push({ status: "NOT_EVALUATED", ruleId, figure, dedupeKey, reason });
    if (todayGate) {
      skip(todayGate);
      continue;
    }
    const now = today!.trust[figure];
    const before = yesterday?.trust[figure];
    if (!now) {
      skip("no_trust");
      continue;
    }
    if (!before || before.grade === "UNKNOWN") {
      skip("previous_trust_unknown");
      continue;
    }
    if (!(now.grade === "LOW" && (before.grade === "HIGH" || before.grade === "MEDIUM"))) {
      outcomes.push({ status: "CLEAR", ruleId, figure, dedupeKey });
      continue;
    }
    const nowLow = magnitudeOf(now.lowSignals);
    const beforeLow = magnitudeOf(before.lowSignals);
    outcomes.push({
      status: "FIRED",
      ruleId,
      figure,
      dedupeKey,
      severity: 1,
      capped: false,
      observed: now.lowSignals,
      baseline: { method: "threshold", value: before.lowSignals, windowWeeks: 0 },
      deviationBps: definedDeviation(deviationBps(nowLow, beforeLow), nowLow - beforeLow),
      trust: now,
      trustReasons: [],
      pointDates: [],
    });
  }
}

function summarize(outcomes: readonly RuleOutcome[]): Record<string, number> {
  const summary: Record<string, number> = { rules_fired: 0, rules_capped: 0, rules_clear: 0, rules_not_evaluated: 0 };
  for (const o of outcomes) {
    if (o.status === "FIRED") {
      summary.rules_fired! += 1;
      if (o.capped) summary.rules_capped! += 1;
    } else if (o.status === "CLEAR") {
      summary.rules_clear! += 1;
    } else {
      summary.rules_not_evaluated! += 1;
      const byReason = `not_evaluated_${o.reason}`;
      summary[byReason] = (summary[byReason] ?? 0) + 1;
      // Per rule, so "Treat with care" can say which check was skipped and why (BUSINESS-INTELLIGENCE iq2-s3r-bi).
      const byRule = `not_evaluated:${o.ruleId}:${o.reason}`;
      summary[byRule] = (summary[byRule] ?? 0) + 1;
    }
  }
  return summary;
}

