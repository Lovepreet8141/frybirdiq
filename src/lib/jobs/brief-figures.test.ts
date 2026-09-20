import { describe, expect, it } from "vitest";

import type { DayFacts, DayTrustRow } from "@/lib/iq/detect/day";
import { observed } from "@/lib/iq/engine/observed-factory";
import type { TrustGrade } from "@/lib/iq/trust";

import { briefFiguresFrom, type BriefSpanRead } from "./brief-figures";

const DATE = "2026-09-11";
const AT = new Date("2026-09-12T02:00:00Z");

const facts = (totals: DayFacts["totals"], computed = true): DayFacts => ({ computed, totals, breakdowns: {} });

const trustRow = (signalId: DayTrustRow["signalId"], grade: TrustGrade, options: { numerator?: bigint; denominator?: bigint; at?: Date } = {}): DayTrustRow => ({
  signalId,
  grade,
  numerator: options.numerator ?? 9n,
  denominator: options.denominator ?? 10n,
  computedAt: options.at ?? AT,
});

const highDay = [trustRow("t5_clock_sanity", "HIGH"), trustRow("t6_payment_integrity", "HIGH")];

const span = (revenue: bigint | null, trust: readonly DayTrustRow[]): BriefSpanRead =>
  revenue === null ? { computed: false, totals: {}, trust } : { computed: true, totals: { revenue_net: revenue }, trust };

const noSpan = span(null, []);

describe("briefFiguresFrom (IQ-2 S10 figures)", () => {
  it("takes the four shared day figures from the detectors' own derivation", () => {
    const read = briefFiguresFrom(
      { date: DATE, facts: facts({ revenue_net: 94_290n, orders_paid: 3n }), trust: highDay, netCollected: null },
      noSpan,
      noSpan,
      observed,
    );
    expect(read.day.revenue_net?.value).toEqual({ unit: "paise", value: "94290" });
    expect(read.day.orders_paid?.value).toEqual({ unit: "count", value: 3 });
    // aov_net = 94290 / 3, derived by the detectors, not recomputed here.
    expect(read.day.aov_net?.value).toEqual({ unit: "paise", value: "31430" });
    expect(read.day.revenue_net?.trust.grade).toBe("HIGH");
  });

  it("derives net_collected as captured minus refunds, which the detectors do not carry", () => {
    const read = briefFiguresFrom(
      { date: DATE, facts: facts({ captured_amount: 120_000n, refunds_amount: 20_000n }), trust: highDay, netCollected: 100_000n },
      noSpan,
      noSpan,
      observed,
    );
    expect(read.day.net_collected?.value).toEqual({ unit: "paise", value: "100000" });
  });

  it("has no figures at all for a day the facts job never computed", () => {
    const read = briefFiguresFrom({ date: DATE, facts: facts({ revenue_net: 1n }, false), trust: highDay, netCollected: null }, noSpan, noSpan, observed);
    expect(read.day).toEqual({});
  });

  it("has no figure for a day with no trust rows, so the brief never cites an unscored number", () => {
    const read = briefFiguresFrom({ date: DATE, facts: facts({ revenue_net: 1n, captured_amount: 1n }), trust: [], netCollected: 1n }, noSpan, noSpan, observed);
    expect(read.day).toEqual({});
  });

  it("sums a span's net sales and grades it by the worst day in it, not the last", () => {
    const monthToDate = span(500_000n, [
      trustRow("t5_clock_sanity", "HIGH", { at: new Date("2026-09-11T02:00:00Z") }),
      trustRow("t6_payment_integrity", "LOW", { numerator: 1n, denominator: 4n, at: new Date("2026-09-02T02:00:00Z") }),
      trustRow("t6_payment_integrity", "HIGH", { at: AT }),
    ]);
    const read = briefFiguresFrom({ date: DATE, facts: facts({}, false), trust: [], netCollected: null }, monthToDate, noSpan, observed);
    expect(read.monthToDate?.value).toEqual({ unit: "paise", value: "500000" });
    expect(read.monthToDate?.trust.grade).toBe("LOW");
    expect(read.monthToDate?.trust.signalId).toBe("t6_payment_integrity");
    // The ratio is the low day's own stored one, never a sum across days.
    expect(read.monthToDate?.trust.ratio).toEqual({ numerator: 1n, denominator: 4n });
    // As of the latest row read, so a stale span is visible as stale.
    expect(read.monthToDate?.trust.asOf).toBe("2026-09-12T07:30:00+05:30");
  });

  it("drops a span no day of which has facts rather than reporting zero sales", () => {
    const read = briefFiguresFrom({ date: DATE, facts: facts({}, false), trust: [], netCollected: null }, span(null, highDay), span(0n, highDay), observed);
    expect(read.monthToDate).toBeNull();
    expect(read.sameDaysLastMonth?.value).toEqual({ unit: "paise", value: "0" });
  });
});
