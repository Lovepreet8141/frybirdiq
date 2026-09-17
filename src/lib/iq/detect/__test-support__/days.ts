/** DetectDay fixtures: flat same-weekday baselines with every figure at a known value and HIGH trust. */
import { observed } from "@/lib/iq/engine/observed-factory";
import type { Observed, TrustGradeInput } from "@/lib/iq/engine";

import { baselineDates } from "../baseline";
import { DETECT_FIGURES, FIGURE_UNITS, type DetectDay, type DetectFigureId, type DetectTrust } from "../rules";

export const D = "2026-09-11";
export const PREVIOUS = "2026-09-10";
export const AS_OF = "2026-09-12T02:10:00+05:30";

export const BASE: Readonly<Record<DetectFigureId, bigint>> = {
  revenue_net: 1000000n,
  orders_paid: 40n,
  aov_net: 50000n,
  discount_share: 300n,
  orders_cancelled_failed: 1n,
  refunds_amount: 0n,
  sales_gross: 1000000n,
  waste_cost: 200000n,
  food_cost_pct_theoretical: 3000n,
  online_share: 2000n,
};

export function figure(id: DetectFigureId, value: bigint): Observed {
  const unit = FIGURE_UNITS[id];
  return unit === "paise" ? observed({ unit, value: value.toString() }) : observed({ unit, value: Number(value) });
}

export function trustOf(grade: TrustGradeInput = "HIGH", lowSignals = 0): DetectTrust {
  return {
    grade,
    signalId: "t1_recipe_coverage",
    ratio: { numerator: 95n, denominator: 100n },
    asOf: AS_OF,
    lowSignals: observed({ unit: "count", value: lowSignals }),
  };
}

export type DayOptions = {
  readonly values?: Partial<Record<DetectFigureId, bigint | null>>;
  readonly grades?: Partial<Record<DetectFigureId, TrustGradeInput | null>>;
  readonly lowSignals?: Partial<Record<DetectFigureId, number>>;
  readonly hasFacts?: boolean;
  readonly parityFlagged?: boolean;
};

export function day(date: string, options: DayOptions = {}): DetectDay {
  const figures: Partial<Record<DetectFigureId, Observed>> = {};
  const trust: Partial<Record<DetectFigureId, DetectTrust>> = {};
  for (const id of DETECT_FIGURES) {
    const value = options.values && id in options.values ? options.values[id] : BASE[id];
    if (value !== null && value !== undefined) figures[id] = figure(id, value);
    const grade = options.grades && id in options.grades ? options.grades[id] : "HIGH";
    if (grade !== null && grade !== undefined) trust[id] = trustOf(grade, options.lowSignals?.[id] ?? 0);
  }
  return { date, hasFacts: options.hasFacts ?? true, parityFlagged: options.parityFlagged ?? false, figures, trust };
}

/** D, the day before, and 8 baseline days. `baseline(i)` customises the i-th baseline day (0 = most recent). */
export function history(today: DayOptions = {}, baseline: (index: number) => DayOptions = () => ({}), previous: DayOptions = {}): DetectDay[] {
  return [day(D, today), day(PREVIOUS, previous), ...baselineDates(D).map((date, i) => day(date, baseline(i)))];
}
