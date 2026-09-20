import { describe, expect, it } from "vitest";

import { observed } from "@/lib/iq/engine/observed-factory";

import { CLOSE, D, HOURS, NORMAL, OPEN, flatBaseline, pulseDay, type BucketValues } from "./__test-support__/pulse-days";
import { baselineDates } from "./baseline";
import { evaluatePulse, istAt, minuteOfDay, pulseDayFrom, type PulseInput, type PulseOutcome, type PulseRuleId } from "./pulse";

const count = (n: number) => observed({ unit: "count", value: n });

function input(endMinute: number, today: BucketValues = NORMAL, extra: Partial<PulseInput> = {}, todayOverride?: (m: number) => BucketValues | null): PulseInput {
  return {
    date: D,
    endMinute,
    hours: HOURS,
    today: pulseDay(D, today, todayOverride),
    baseline: flatBaseline(),
    ordersLast45: count(12),
    ...extra,
  };
}

const find = (outcomes: readonly PulseOutcome[], ruleId: PulseRuleId) => outcomes.find((o) => o.ruleId === ruleId)!;

describe("pulse.sales_pace_below", () => {
  const after2h = OPEN + 120; // 13:30, 8 buckets; baseline 800,000 paise, σ floor ₹500 → z ≤ −3 at 650,000, −30% at 560,000

  it("fires at 30% below the weekday pace, and is clear just inside it", () => {
    expect(find(evaluatePulse(input(after2h, { ...NORMAL, revenue: 70000n })).outcomes, "pulse.sales_pace_below")).toMatchObject({
      status: "FIRED",
      severity: 2,
      observed: { unit: "paise", value: "560000" },
      baseline: { method: "median_mad", value: { unit: "paise", value: "800000" }, windowWeeks: 8 },
      deviationBps: -3000,
      window: { startMinute: OPEN, endMinute: after2h },
      dedupeKey: `pulse:pulse.sales_pace_below:${D}`,
    });
    expect(find(evaluatePulse(input(after2h, { ...NORMAL, revenue: 70100n })).outcomes, "pulse.sales_pace_below").status).toBe("CLEAR");
  });

  it("waits 2 hours after opening", () => {
    expect(find(evaluatePulse(input(after2h - 15, { ...NORMAL, revenue: 0n })).outcomes, "pulse.sales_pace_below")).toMatchObject({
      status: "NOT_EVALUATED",
      reason: "not_open_long_enough",
    });
  });
});

describe("pulse.no_orders", () => {
  const end = 13 * 60; // 13:00: window 12:15–13:00, baseline 3 buckets × 4 = 12 orders

  it("fires at severity 3 on zero orders in a window that normally has ≥ 3", () => {
    expect(find(evaluatePulse(input(end, NORMAL, { ordersLast45: count(0) })).outcomes, "pulse.no_orders")).toMatchObject({
      status: "FIRED",
      severity: 3,
      observed: { unit: "count", value: 0 },
      baseline: { value: { unit: "count", value: 12 } },
      window: { startMinute: end - 45, endMinute: end },
    });
  });

  it("is clear with one order, or when the window is normally quiet (median below 3)", () => {
    expect(find(evaluatePulse(input(end, NORMAL, { ordersLast45: count(1) })).outcomes, "pulse.no_orders").status).toBe("CLEAR");
    const quiet = flatBaseline({ ...NORMAL, orders: 0n }, (_i, date) => pulseDay(date, NORMAL, (m) => (m >= end - 45 && m < end ? { orders: m === end - 45 ? 2n : 0n } : null)));
    expect(find(evaluatePulse(input(end, NORMAL, { ordersLast45: count(0), baseline: quiet })).outcomes, "pulse.no_orders").status).toBe("CLEAR");
  });

  it("counts orders directly: a missing count is not a zero", () => {
    expect(find(evaluatePulse(input(end, NORMAL, { ordersLast45: null })).outcomes, "pulse.no_orders")).toMatchObject({ reason: "no_order_count" });
  });

  it("does not look back past opening", () => {
    expect(find(evaluatePulse(input(OPEN + 30, NORMAL, { ordersLast45: count(0) })).outcomes, "pulse.no_orders")).toMatchObject({
      reason: "window_before_opening",
    });
  });
});

describe("pulse.kitchen_slow", () => {
  const end = 14 * 60; // window 13:00–14:00, baseline mean 600 s

  const slow = (seconds: bigint, tickets = 2n) => input(end, NORMAL, {}, (m) => (m >= end - 60 && m < end ? { tickets, seconds } : null));

  it("fires when the mean is ≥ 50% and ≥ 5 min above the weekday median", () => {
    // 4 buckets × 2 tickets, 900 s each → mean 900 s = 600 × 1.5 and +300 s
    expect(find(evaluatePulse(slow(1800n)).outcomes, "pulse.kitchen_slow")).toMatchObject({
      status: "FIRED",
      severity: 2,
      observed: { unit: "seconds", value: 900 },
      baseline: { value: { unit: "seconds", value: 600 } },
      deviationBps: 5000,
    });
  });

  it("is clear one second below the line", () => {
    // 1,798 s per bucket over 8 tickets → mean 899 s, just under 1.5 × 600
    expect(find(evaluatePulse(slow(1798n)).outcomes, "pulse.kitchen_slow").status).toBe("CLEAR");
  });

  it("needs at least 5 tickets in the window", () => {
    expect(find(evaluatePulse(slow(900n, 1n)).outcomes, "pulse.kitchen_slow")).toMatchObject({ reason: "too_few_tickets" });
  });
});

describe("the day's gates", () => {
  const reasons = (i: PulseInput) => evaluatePulse(i).outcomes.map((o) => (o.status === "NOT_EVALUATED" ? o.reason : o.status));

  it("before or at opening, nothing is evaluated", () => {
    expect(reasons(input(OPEN))).toEqual(["outside_hours", "outside_hours", "outside_hours"]);
  });

  it("after closing, every rule is CLOSED so the job expires them with CLOSING_TIME", () => {
    expect(reasons(input(CLOSE + 15))).toEqual(["CLOSED", "CLOSED", "CLOSED"]);
    expect(reasons(input(CLOSE)).includes("CLOSED")).toBe(false);
  });

  it("refuses hours that wrap past midnight, and malformed hours", () => {
    expect(reasons(input(13 * 60, NORMAL, { hours: { opening: "18:00", closing: "02:00" } }))).toEqual(Array(3).fill("hours_wrap_unsupported"));
    expect(reasons(input(13 * 60, NORMAL, { hours: { opening: "25:00", closing: "23:00" } }))).toEqual(Array(3).fill("hours_invalid"));
  });

  it("does not evaluate a day without intraday facts or an owner-excluded date", () => {
    expect(reasons({ ...input(14 * 60), today: pulseDay(D, NORMAL, undefined, false) })).toEqual(Array(3).fill("no_intraday_facts"));
    expect(reasons(input(14 * 60, NORMAL, { excludedDates: [D] }))).toEqual(Array(3).fill("excluded_date"));
  });

  it("drops closed, uncomputed and excluded baseline days: 4 points evaluate, 3 do not", () => {
    const dates = baselineDates(D);
    const baseline = flatBaseline(NORMAL, (i, date) =>
      i === 0 ? pulseDay(date, { ...NORMAL, orders: 0n }) : i === 1 ? pulseDay(date, NORMAL, undefined, false) : null,
    );
    const at = OPEN + 120;
    const low = { ...NORMAL, revenue: 0n };
    expect(find(evaluatePulse(input(at, low, { baseline, excludedDates: [dates[2]!, dates[3]!] })).outcomes, "pulse.sales_pace_below").status).toBe("FIRED");
    expect(
      find(evaluatePulse(input(at, low, { baseline, excludedDates: [dates[2]!, dates[3]!, dates[4]!] })).outcomes, "pulse.sales_pace_below"),
    ).toMatchObject({ reason: "insufficient_history" });
  });

  it("names each skipped check in the summary", () => {
    const { summary } = evaluatePulse(input(OPEN + 30, NORMAL, { ordersLast45: null }));
    expect(summary["not_evaluated:pulse.no_orders:window_before_opening"]).toBe(1);
    expect(summary["not_evaluated:pulse.sales_pace_below:not_open_long_enough"]).toBe(1);
  });
});

describe("helpers", () => {
  it("parses HH:MM and formats IST instants, including the next midnight", () => {
    expect([minuteOfDay("11:30"), minuteOfDay("24:00"), minuteOfDay("9:30")]).toEqual([690, null, null]);
    expect([istAt(D, 780), istAt(D, 1440)]).toEqual(["2026-09-11T13:00:00+05:30", "2026-09-12T00:00:00+05:30"]);
  });

  it("pulseDayFrom sums rows per bucket and refuses a minute off a 15-minute boundary", () => {
    const day = pulseDayFrom(
      D,
      true,
      [
        { startMinute: 690, metricId: "orders_paid", value: 2n },
        { startMinute: 690, metricId: "orders_paid", value: 3n },
        { startMinute: 690, metricId: "revenue_net", value: 50000n },
      ],
      observed,
    );
    expect(day.buckets).toEqual([
      {
        startMinute: 690,
        ordersPaid: { unit: "count", value: 5 },
        revenueNet: { unit: "paise", value: "50000" },
        ticketsReady: { unit: "count", value: 0 },
        ticketSeconds: { unit: "count", value: 0 },
      },
    ]);
    expect(() => pulseDayFrom(D, true, [{ startMinute: 691, metricId: "orders_paid", value: 1n }], observed)).toThrow(/15-minute/);
  });
});
