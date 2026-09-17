/**
 * detectDayFrom — one source of truth for what the detectors read for a day.
 *
 * ARCHITECT review of 56fc9ba (iq2-s7c): the job runner's repository re-derived
 * every figure and re-implemented "trust = lowest signal grade". This module owns
 * both, as pure code; the repository keeps only the two org-scoped reads (daily
 * facts, daily trust rows) and binds them here.
 *
 * - Figures come from `FIGURE_INPUTS`, each a derivation over one day's summed
 *   facts using the metrics catalog's own helpers. A day without computed facts
 *   has no figures; a ratio with no denominator is absent, never zero.
 * - Trust is ANALYTICS-DATA's `metricTrust` for each metric the figure rests on,
 *   combined with `lowerGrade`. Its rule holds: a HIGH figure names no limiting
 *   signal. The score still comes from a stored ratio — the limiting signal's,
 *   or at HIGH the weakest scored signal's — never an invented number.
 * - A day with no trust rows has no trust entries, so its rules do not evaluate.
 * - `parityFlagged` is false: parity is per month, no per-day flag exists until
 *   IQ-2 S4 (god's ruling).
 *
 * Observed quantities are minted by the caller's `observe` (a repository may
 * mint; this module may not import the factory).
 */
import type { Observed, Quantity } from "@/lib/iq/engine";
import {
  type AnyMetricId,
  type MetricId,
  type TrustSignalId,
  aovNetV2,
  channelShare,
  foodCostPctTheoretical,
  getDerivedMetric,
  getMetric,
  isDerivedMetricId,
  ratioBpsOrNull,
} from "@/lib/iq/metrics";
import { type TrustGrade, lowerGrade, metricTrust } from "@/lib/iq/trust";
import { paise } from "@/lib/money";

import { istTimestamp } from "./detect-job";
import { DETECT_FIGURES, FIGURE_UNITS, type DetectDay, type DetectFigureId, type DetectTrust } from "./rules";

/** One IST business day's summed daily facts (the shape `readDailyFacts` returns for a single date). */
export type DayFacts = {
  /** True when the facts job computed this day. */
  readonly computed: boolean;
  readonly totals: Readonly<Partial<Record<MetricId, bigint>>>;
  readonly breakdowns: Readonly<Partial<Record<MetricId, Readonly<Record<string, Readonly<Record<string, bigint>>>>>>>;
};

/** One stored `iq_daily_trust` row for the day. */
export type DayTrustRow = {
  readonly signalId: TrustSignalId;
  readonly grade: TrustGrade;
  readonly numerator: bigint;
  readonly denominator: bigint;
  readonly computedAt: Date;
};

type FigureInput = {
  /** The metrics the figure rests on: its trust is the lowest of theirs. */
  readonly trustMetrics: readonly AnyMetricId[];
  /** The figure in its unit, or null when it has no value that day. */
  readonly derive: (facts: DayFacts) => bigint | null;
  readonly description: string;
};

const total = (facts: DayFacts, id: MetricId): bigint => facts.totals[id] ?? 0n;

export const FIGURE_INPUTS: Readonly<Record<DetectFigureId, FigureInput>> = {
  revenue_net: {
    trustMetrics: ["revenue_net"],
    derive: (f) => total(f, "revenue_net"),
    description: "revenue_net",
  },
  orders_paid: {
    trustMetrics: ["orders_paid"],
    derive: (f) => total(f, "orders_paid"),
    description: "orders_paid",
  },
  aov_net: {
    trustMetrics: ["aov_net"],
    derive: (f) => aovNetV2(paise(total(f, "revenue_net")), total(f, "orders_paid")),
    description: "aovNetV2(revenue_net, orders_paid); absent when orders_paid = 0",
  },
  discount_share: {
    trustMetrics: ["discount_total", "sales_gross"],
    derive: (f) => {
      const share = ratioBpsOrNull(paise(total(f, "discount_total")), paise(total(f, "sales_gross")));
      return share === null ? null : BigInt(share);
    },
    // ANALYTICS-DATA iq2-s3r-ad (c): discount_total is before tax, sales_gross is after discount and
    // points incl. GST — the discount as a share of what customers paid, not of the list price.
    description: "ratioBpsOrNull(discount_total, sales_gross); absent when sales_gross ≤ 0",
  },
  orders_cancelled_failed: {
    trustMetrics: ["orders_cancelled", "orders_failed"],
    derive: (f) => total(f, "orders_cancelled") + total(f, "orders_failed"),
    description: "orders_cancelled + orders_failed",
  },
  refunds_amount: {
    trustMetrics: ["refunds_amount"],
    derive: (f) => total(f, "refunds_amount"),
    description: "refunds_amount (GST-inclusive)",
  },
  sales_gross: {
    trustMetrics: ["sales_gross"],
    derive: (f) => total(f, "sales_gross"),
    description: "sales_gross (GST-inclusive, the basis refunds_amount is on)",
  },
  waste_cost: {
    trustMetrics: ["waste_cost"],
    derive: (f) => total(f, "waste_cost"),
    description: "waste_cost",
  },
  food_cost_pct_theoretical: {
    trustMetrics: ["food_cost_pct_theoretical"],
    derive: (f) => {
      const pct = foodCostPctTheoretical(paise(total(f, "food_cost_theoretical")), paise(total(f, "revenue_net")));
      return pct === null ? null : BigInt(pct);
    },
    description: "foodCostPctTheoretical(food_cost_theoretical, revenue_net); absent when revenue_net ≤ 0",
  },
  online_share: {
    trustMetrics: ["channel_share"],
    derive: (f) => {
      const online = f.breakdowns.revenue_net?.channel?.ONLINE ?? 0n;
      const share = channelShare(paise(online), paise(total(f, "revenue_net")));
      return share === null ? null : BigInt(share);
    },
    description: "channelShare(revenue_net[channel=ONLINE], revenue_net); absent when revenue_net ≤ 0",
  },
};

function signalsOf(metricIds: readonly AnyMetricId[]): TrustSignalId[] {
  const signals: TrustSignalId[] = [];
  for (const id of metricIds) {
    const definition = isDerivedMetricId(id) ? getDerivedMetric(id) : getMetric(id);
    for (const signal of definition.trustSignals) if (!signals.includes(signal)) signals.push(signal);
  }
  return signals;
}

/** The weakest scored ratio among rows (compared exactly by cross-multiplication). */
function weakestRatio(rows: readonly DayTrustRow[]): { numerator: bigint; denominator: bigint } | null {
  let weakest: DayTrustRow | null = null;
  for (const row of rows) {
    if (row.denominator <= 0n) continue;
    if (!weakest || row.numerator * weakest.denominator < weakest.numerator * row.denominator) weakest = row;
  }
  return weakest ? { numerator: weakest.numerator, denominator: weakest.denominator } : null;
}

function figureTrust(
  figure: DetectFigureId,
  grades: Readonly<Partial<Record<TrustSignalId, TrustGrade>>>,
  rows: ReadonlyMap<TrustSignalId, DayTrustRow>,
  asOf: string,
  observe: (q: Quantity) => Observed,
): DetectTrust {
  const input = FIGURE_INPUTS[figure];
  let grade: TrustGrade | null = null;
  let signalId: TrustSignalId | null = null;
  for (const metricId of input.trustMetrics) {
    const trust = metricTrust(metricId, grades);
    if (grade === null || lowerGrade(grade, trust.grade) !== grade) {
      grade = trust.grade;
      signalId = trust.limitingSignal;
    }
  }
  const final = grade ?? "UNKNOWN";
  const signals = signalsOf(input.trustMetrics);
  const lowSignals = signals.filter((s) => (grades[s] ?? "UNKNOWN") === "LOW").length;

  let ratio: { numerator: bigint; denominator: bigint } | null = null;
  if (final === "HIGH") {
    ratio = weakestRatio(signals.map((s) => rows.get(s)).filter((r): r is DayTrustRow => r !== undefined));
  } else if (signalId !== null) {
    const row = rows.get(signalId);
    ratio = row && row.denominator > 0n ? { numerator: row.numerator, denominator: row.denominator } : null;
  }
  return {
    grade: final,
    signalId: final === "HIGH" ? null : signalId,
    ratio,
    asOf,
    lowSignals: observe({ unit: "count", value: lowSignals }),
  };
}

function toQuantity(figure: DetectFigureId, value: bigint): Quantity {
  const unit = FIGURE_UNITS[figure];
  if (unit === "paise") return { unit, value: value.toString() };
  return { unit, value: Number(value) };
}

export function detectDayFrom(
  date: string,
  dailyFacts: DayFacts,
  trustGrades: readonly DayTrustRow[],
  observe: (q: Quantity) => Observed,
): DetectDay {
  const figures: Partial<Record<DetectFigureId, Observed>> = {};
  if (dailyFacts.computed) {
    for (const id of DETECT_FIGURES) {
      const value = FIGURE_INPUTS[id].derive(dailyFacts);
      if (value !== null) figures[id] = observe(toQuantity(id, value));
    }
  }

  const trust: Partial<Record<DetectFigureId, DetectTrust>> = {};
  if (trustGrades.length > 0) {
    const asOf = istTimestamp(new Date(Math.max(...trustGrades.map((row) => row.computedAt.getTime()))));
    const grades: Partial<Record<TrustSignalId, TrustGrade>> = {};
    const rows = new Map<TrustSignalId, DayTrustRow>();
    for (const row of trustGrades) {
      grades[row.signalId] = row.grade;
      rows.set(row.signalId, row);
    }
    for (const id of DETECT_FIGURES) trust[id] = figureTrust(id, grades, rows, asOf, observe);
  }

  return { date, hasFacts: dailyFacts.computed, parityFlagged: false, figures, trust };
}
