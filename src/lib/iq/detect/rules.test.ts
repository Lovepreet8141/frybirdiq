import { describe, expect, it } from "vitest";

import type { Observed } from "@/lib/iq/engine";
import { observed } from "@/lib/iq/engine/observed-factory";

import { AS_OF, D, day, history, PREVIOUS, type DayOptions } from "./__test-support__/days";
import { baselineDates } from "./baseline";
import {
  BASELINE_RULES,
  DETECT_FIGURES,
  WASTE_FLOOR_PAISE,
  evaluateDetectDay,
  type DetectDay,
  type DetectFigureId,
  type RuleOutcome,
} from "./rules";

function evaluate(days: readonly DetectDay[], extra: { excludedDates?: string[]; foodCostTarget?: Observed | null } = {}) {
  return evaluateDetectDay({ date: D, days, ...extra });
}

function find(outcomes: readonly RuleOutcome[], ruleId: string, figure?: DetectFigureId): RuleOutcome {
  const o = outcomes.find((x) => x.ruleId === ruleId && (figure === undefined || x.figure === figure));
  if (!o) throw new Error(`no outcome for ${ruleId}`);
  return o;
}

const withValue = (figure: DetectFigureId, value: bigint) => history({ values: { [figure]: value } });

describe("every baseline rule: fires at its boundary and is silent one step inside it", () => {
  it.each([
    ["sales.below_weekday_baseline", "revenue_net", 750000n, 2, 750100n],
    ["sales.below_weekday_baseline", "revenue_net", 600000n, 3, 1000000n],
    ["sales.above_weekday_baseline", "revenue_net", 1300000n, 1, 1299900n],
    ["orders.below_weekday_baseline", "orders_paid", 30n, 2, 31n],
    ["aov.shift", "aov_net", 57500n, 1, 57499n],
    ["aov.shift", "aov_net", 42500n, 1, 42501n],
    ["discount.spike", "discount_share", 800n, 2, 799n],
    ["cancellations.spike", "orders_cancelled_failed", 4n, 2, 3n],
    ["waste.spike", "waste_cost", 300000n, 2, 299999n],
    ["food_cost.above_baseline", "food_cost_pct_theoretical", 3450n, 2, 3449n],
    ["channel_mix.shift", "online_share", 3500n, 1, 3499n],
    ["channel_mix.shift", "online_share", 500n, 1, 501n],
  ] as const)("%s on %s: %s fires at severity %s, %s is clear", (ruleId, figure, fire, severity, silent) => {
    expect(find(evaluate(withValue(figure, fire)).outcomes, ruleId)).toMatchObject({
      status: "FIRED",
      severity,
      capped: false,
      dedupeKey: `detect:${ruleId}:${D}`,
    });
    expect(find(evaluate(withValue(figure, silent)).outcomes, ruleId)).toMatchObject({ status: "CLEAR" });
  });

  it("steps from severity 3 back to 2 one step inside the −40% line", () => {
    expect(find(evaluate(withValue("revenue_net", 600100n)).outcomes, "sales.below_weekday_baseline")).toMatchObject({ severity: 2 });
  });

  it("stays silent when the weekday is noisy enough that −30% is inside 3σ", () => {
    const noisy = history({ values: { revenue_net: 700000n } }, (i) => ({ values: { revenue_net: i % 2 === 0 ? 600000n : 1400000n } }));
    expect(find(evaluate(noisy).outcomes, "sales.below_weekday_baseline")).toMatchObject({ status: "CLEAR" });
  });

  it("puts the Observed median, the method and the window in the baseline", () => {
    const fired = find(evaluate(withValue("revenue_net", 750000n)).outcomes, "sales.below_weekday_baseline");
    if (fired.status !== "FIRED") throw new Error("expected a detection");
    expect(fired.baseline).toEqual({ method: "median_mad", value: { unit: "paise", value: "1000000" }, windowWeeks: 8 });
    expect(fired.deviationBps).toBe(-2500);
    expect(fired.pointDates).toEqual(baselineDates(D));
  });

  it("uses the reviewed waste floor of ₹1,000", () => {
    expect(WASTE_FLOOR_PAISE).toBe(100000n);
  });

  it("the table holds exactly the nine §2 baseline rules", () => {
    expect(BASELINE_RULES.map((r) => r.ruleId).sort()).toEqual(
      [
        "aov.shift",
        "cancellations.spike",
        "channel_mix.shift",
        "discount.spike",
        "food_cost.above_baseline",
        "orders.below_weekday_baseline",
        "sales.above_weekday_baseline",
        "sales.below_weekday_baseline",
        "waste.spike",
      ].sort(),
    );
  });

  it("is clear on every baseline rule on an ordinary day", () => {
    const outcomes = evaluate(history()).outcomes.filter((o) => BASELINE_RULES.some((r) => r.ruleId === o.ruleId));
    expect(outcomes.map((o) => o.status)).toEqual(BASELINE_RULES.map(() => "CLEAR"));
  });
});

describe("refunds.spike (threshold, gross basis)", () => {
  it("fires at severity 2 above 2% of gross sales and is clear at or below it (amount arm only)", () => {
    // sales_gross 1,000,000 paise → 2% = 20,000
    expect(find(evaluate(history({ values: { refunds_amount: 20001n } })).outcomes, "refunds.spike")).toMatchObject({
      status: "FIRED",
      severity: 2,
      observed: { unit: "paise", value: "20001" },
      baseline: { method: "threshold", value: { unit: "paise", value: "20000" }, windowWeeks: 0 },
    });
    expect(find(evaluate(history({ values: { refunds_amount: 20000n } })).outcomes, "refunds.spike").status).toBe("CLEAR");
    expect(find(evaluate(history({ values: { refunds_amount: 0n } })).outcomes, "refunds.spike").status).toBe("CLEAR");
  });

  it("compares with gross sales, not net sales (refunds include GST)", () => {
    // 2% of net sales (revenue_net 900,000) would be 18,000, so 19,000 would fire on net; on gross (2% = 20,000) it is clear.
    const days = history({ values: { revenue_net: 900000n, sales_gross: 1000000n, refunds_amount: 19000n } });
    expect(find(evaluate(days).outcomes, "refunds.spike").status).toBe("CLEAR");
  });

  it("has no refund-count arm", () => {
    expect(DETECT_FIGURES).not.toContain("refunds_count");
  });

  it("is not evaluated without gross sales", () => {
    expect(find(evaluate(history({ values: { sales_gross: null, refunds_amount: 50000n } })).outcomes, "refunds.spike")).toMatchObject({
      status: "NOT_EVALUATED",
      reason: "figure_missing",
    });
  });
});

describe("per-figure σ floors (RESTAURANT-OPS iq2-s3r-ops)", () => {
  it("a zero-median cancellations weekday fires at 3 and stays silent at 2", () => {
    const zeroBase = (value: bigint) => history({ values: { orders_cancelled_failed: value } }, () => ({ values: { orders_cancelled_failed: 0n } }));
    expect(find(evaluate(zeroBase(3n)).outcomes, "cancellations.spike")).toMatchObject({ status: "FIRED", severity: 2 });
    for (const n of [4n, 5n, 6n, 7n, 8n]) expect(find(evaluate(zeroBase(n)).outcomes, "cancellations.spike").status).toBe("FIRED");
    expect(find(evaluate(zeroBase(2n)).outcomes, "cancellations.spike").status).toBe("CLEAR");
  });

  it("the waste ₹1,000 rule floor binds: +₹999.99 over a flat ₹2,000 is silent even though z ≥ 3", () => {
    expect(find(evaluate(withValue("waste_cost", 299999n)).outcomes, "waste.spike").status).toBe("CLEAR");
    expect(find(evaluate(withValue("waste_cost", 300000n)).outcomes, "waste.spike").status).toBe("FIRED");
  });

  it("the orders drop ≥ 5 rule floor binds on a quiet weekday", () => {
    const quiet = (value: bigint) => history({ values: { orders_paid: value } }, () => ({ values: { orders_paid: 16n } }));
    expect(find(evaluate(quiet(11n)).outcomes, "orders.below_weekday_baseline").status).toBe("FIRED");
    expect(find(evaluate(quiet(12n)).outcomes, "orders.below_weekday_baseline").status).toBe("CLEAR");
  });
});

describe("food_cost.above_target (dec-7)", () => {
  const target = observed({ unit: "bps", value: 3000 });

  it("fires at target + 2 points and is clear one bps below", () => {
    expect(find(evaluate(history({ values: { food_cost_pct_theoretical: 3200n } }), { foodCostTarget: target }).outcomes, "food_cost.above_target")).toMatchObject({
      status: "FIRED",
      severity: 2,
      baseline: { method: "threshold", value: { unit: "bps", value: 3000 } },
    });
    expect(find(evaluate(history({ values: { food_cost_pct_theoretical: 3199n } }), { foodCostTarget: target }).outcomes, "food_cost.above_target").status).toBe("CLEAR");
  });

  it("is not evaluated while the owner has set no target", () => {
    expect(find(evaluate(history({ values: { food_cost_pct_theoretical: 9000n } })).outcomes, "food_cost.above_target")).toMatchObject({
      status: "NOT_EVALUATED",
      reason: "no_target",
    });
  });
});

describe("trust.grade_dropped", () => {
  it("fires per figure that fell to LOW from HIGH or MEDIUM, at severity 1, never capped", () => {
    const days = history({ grades: { revenue_net: "LOW" }, lowSignals: { revenue_net: 2 } }, () => ({}), { grades: { revenue_net: "MEDIUM" } });
    expect(find(evaluate(days).outcomes, "trust.grade_dropped", "revenue_net")).toMatchObject({
      status: "FIRED",
      severity: 1,
      capped: false,
      dedupeKey: `detect:trust.grade_dropped:revenue_net:${D}`,
      observed: { unit: "count", value: 2 },
      baseline: { method: "threshold", value: { unit: "count", value: 0 } },
    });
    expect(find(evaluate(days).outcomes, "trust.grade_dropped", "orders_paid").status).toBe("CLEAR");
  });

  it("is clear when it was already LOW, and not evaluated when the day before is UNKNOWN or missing", () => {
    const already = history({ grades: { revenue_net: "LOW" } }, () => ({}), { grades: { revenue_net: "LOW" } });
    expect(find(evaluate(already).outcomes, "trust.grade_dropped", "revenue_net").status).toBe("CLEAR");
    const unknown = history({ grades: { revenue_net: "LOW" } }, () => ({}), { grades: { revenue_net: "UNKNOWN" } });
    expect(find(evaluate(unknown).outcomes, "trust.grade_dropped", "revenue_net")).toMatchObject({ status: "NOT_EVALUATED", reason: "previous_trust_unknown" });
    const missing = history({ grades: { revenue_net: "LOW" } }).filter((d) => d.date !== PREVIOUS);
    expect(find(evaluate(missing).outcomes, "trust.grade_dropped", "revenue_net")).toMatchObject({ status: "NOT_EVALUATED", reason: "previous_trust_unknown" });
  });
});

describe("trust gating (§2, R2.4)", () => {
  it.each(["LOW", "UNKNOWN"] as const)("%s trust: a firing rule publishes capped at severity 1 with CAPPED_LOW_TRUST", (grade) => {
    expect(find(evaluate(history({ values: { revenue_net: 600000n }, grades: { revenue_net: grade } })).outcomes, "sales.below_weekday_baseline")).toMatchObject({
      status: "FIRED",
      severity: 1,
      capped: true,
      trustReasons: ["CAPPED_LOW_TRUST"],
    });
  });

  it.each(["LOW", "UNKNOWN"] as const)("%s trust: a silent rule is not evaluated, so nothing expires", (grade) => {
    expect(find(evaluate(history({ grades: { revenue_net: grade } })).outcomes, "sales.below_weekday_baseline")).toMatchObject({
      status: "NOT_EVALUATED",
      reason: "low_trust",
    });
  });

  it("MEDIUM trust publishes at full severity", () => {
    expect(find(evaluate(history({ values: { revenue_net: 600000n }, grades: { revenue_net: "MEDIUM" } })).outcomes, "sales.below_weekday_baseline")).toMatchObject({
      severity: 3,
      capped: false,
    });
  });
});

describe("days that are not evaluated", () => {
  it.each([
    ["a closed day (orders_paid = 0)", history({ values: { orders_paid: 0n } }), [], "closed_day"],
    ["an owner-excluded date", history({ values: { revenue_net: 100000n } }), [D], "excluded_date"],
    ["a day with no facts", history({ hasFacts: false }), [], "no_facts"],
    ["a day flagged by facts parity", history({ values: { revenue_net: 100000n }, parityFlagged: true }), [], "parity_flagged"],
  ] as const)("%s: every rule is NOT_EVALUATED, none fires or clears", (_case, days, excludedDates, reason) => {
    const { outcomes, summary } = evaluate(days, { excludedDates: [...excludedDates] });
    expect(outcomes.every((o) => o.status === "NOT_EVALUATED" && o.reason === reason)).toBe(true);
    expect(summary[`not_evaluated_${reason}`]).toBe(outcomes.length);
  });

  it("owner-excluded dates default to none", () => {
    expect(find(evaluateDetectDay({ date: D, days: withValue("revenue_net", 600000n) }).outcomes, "sales.below_weekday_baseline").status).toBe("FIRED");
  });

  it("reports a missing figure, missing trust and a zero median separately", () => {
    expect(find(evaluate(history({ values: { aov_net: null } })).outcomes, "aov.shift")).toMatchObject({ reason: "figure_missing" });
    expect(find(evaluate(history({ grades: { aov_net: null } })).outcomes, "aov.shift")).toMatchObject({ reason: "no_trust" });
    const zero = history({ values: { revenue_net: 0n } }, () => ({ values: { revenue_net: 0n } }));
    expect(find(evaluate(zero).outcomes, "sales.below_weekday_baseline")).toMatchObject({ reason: "zero_median" });
  });

  it("refuses a figure in the wrong unit rather than comparing it", () => {
    const days = history();
    const today = days[0]!;
    const broken: DetectDay = { ...today, figures: { ...today.figures, revenue_net: observed({ unit: "count", value: 5 }) } };
    expect(() => evaluate([broken, ...days.slice(1)])).toThrow(/revenue_net must be paise/);
  });
});

describe("baseline points", () => {
  const firstN = (count: number, options: DayOptions) => (i: number): DayOptions => (i < count ? options : {});

  it.each([
    ["closed", { values: { orders_paid: 0n } }],
    ["parity-flagged", { parityFlagged: true }],
    ["without facts", { hasFacts: false }],
    ["LOW-trust for the figure", { grades: { revenue_net: "LOW" as const } }],
  ])("skips %s days: 4 points evaluate, 3 do not", (_case, options) => {
    expect(find(evaluate(history({ values: { revenue_net: 600000n } }, firstN(4, options))).outcomes, "sales.below_weekday_baseline")).toMatchObject({ status: "FIRED" });
    expect(find(evaluate(history({ values: { revenue_net: 600000n } }, firstN(5, options))).outcomes, "sales.below_weekday_baseline")).toMatchObject({
      status: "NOT_EVALUATED",
      reason: "insufficient_history",
    });
  });

  it("skips owner-excluded baseline dates", () => {
    const excluded = baselineDates(D).slice(0, 5);
    expect(find(evaluate(history({ values: { revenue_net: 600000n } }), { excludedDates: excluded }).outcomes, "sales.below_weekday_baseline")).toMatchObject({
      reason: "insufficient_history",
    });
  });

  it("does not let a LOW-trust baseline day for one figure remove points from another", () => {
    const days = history({ values: { orders_paid: 30n } }, () => ({ grades: { revenue_net: "LOW" } }));
    expect(find(evaluate(days).outcomes, "orders.below_weekday_baseline").status).toBe("FIRED");
    expect(day(D).trust.revenue_net?.asOf).toBe(AS_OF);
  });
});

describe("one outcome per key", () => {
  it("evaluates 9 baseline rules, 2 threshold rules and one trust drop per figure, with unique keys", () => {
    const { outcomes, summary } = evaluate(history({ values: { revenue_net: 600000n } }));
    expect(outcomes).toHaveLength(BASELINE_RULES.length + 2 + DETECT_FIGURES.length);
    expect(new Set(outcomes.map((o) => o.dedupeKey)).size).toBe(outcomes.length);
    expect(summary.rules_fired! + summary.rules_clear! + summary.rules_not_evaluated!).toBe(outcomes.length);
  });
});

describe("summary names each skipped check (BUSINESS-INTELLIGENCE iq2-s3r-bi)", () => {
  it("counts not_evaluated:<ruleId>:<reason> beside the per-reason totals", () => {
    const { summary } = evaluate(history({ grades: { waste_cost: "LOW" } }));
    expect(summary["not_evaluated:waste.spike:low_trust"]).toBe(1);
    expect(summary["not_evaluated:food_cost.above_target:no_target"]).toBe(1);
    expect(summary.not_evaluated_low_trust).toBe(1);
  });

  it("adds up per rule across figures for trust.grade_dropped", () => {
    const { summary } = evaluate(history().filter((d) => d.date !== PREVIOUS));
    expect(summary["not_evaluated:trust.grade_dropped:previous_trust_unknown"]).toBe(DETECT_FIGURES.length);
  });
});
