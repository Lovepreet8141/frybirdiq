import { describe, expect, it } from "vitest";

import { InsightSchema, hasValidContentHash, type Observed } from "@/lib/iq/engine";
import { observed } from "@/lib/iq/engine/observed-factory";

import { D, HOURS, NORMAL, flatBaseline, pulseDay } from "./__test-support__/pulse-days";
import { PULSE_JOB_NAME, lastCompleteBucket, runServicePulse, type PulseExpireRequest, type PulseJobPorts } from "./pulse-job";
import type { OpeningHours, PulseDay } from "./pulse";

const ORG = "11111111-1111-4111-8111-111111111111";
const RUN = "22222222-2222-4222-8222-222222222222";

/** An instant from an IST wall-clock time on D (or the next day). */
const ist = (time: string, date = D) => new Date(`${date}T${time}:00+05:30`);

function fake(options: { now: Date; hours?: OpeningHours; fresh?: boolean; ordersLast45?: number; days?: PulseDay[] }) {
  const calls = { fresh: [] as string[], reads: [] as (readonly string[])[], counts: [] as [string, string][] };
  const written: { insight: unknown; asOf: string }[] = [];
  const expired: PulseExpireRequest[][] = [];
  let n = 0;
  const ports: PulseJobPorts = {
    orgId: ORG,
    runId: RUN,
    attempt: 1,
    codeVersion: "93fd9c5",
    now: () => options.now,
    readOpeningHours: async () => options.hours ?? HOURS,
    intradayFreshAt: async (bucketEnd) => {
      calls.fresh.push(bucketEnd);
      return options.fresh ?? true;
    },
    readPulseDays: async (dates) => {
      calls.reads.push(dates);
      return options.days ?? [pulseDay(D, NORMAL), ...flatBaseline()];
    },
    countPaidOrders: async (from, to): Promise<Observed> => {
      calls.counts.push([from, to]);
      return observed({ unit: "count", value: options.ordersLast45 ?? 12 });
    },
    newId: () => `bbbbbbbb-0000-4000-8000-${String(++n).padStart(12, "0")}`,
    commit: async (write) =>
      write({
        writeInsight: async (insight, { asOf }) => {
          written.push({ insight, asOf });
          return { outcome: "INSERTED" };
        },
        expireInsights: async (requests) => {
          expired.push([...requests]);
          return { expired: requests.length };
        },
      }),
  };
  return { ports, calls, written, expired };
}

describe("lastCompleteBucket", () => {
  it("is the bucket that ended before now, on its IST business day", () => {
    expect(lastCompleteBucket(ist("13:05"))).toMatchObject({ date: D, endMinute: 780 });
    expect(lastCompleteBucket(ist("00:05", "2026-09-12"))).toMatchObject({ date: D, endMinute: 1440 });
  });
});

describe("runServicePulse", () => {
  it("refuses hours that wrap past midnight without reading or writing anything", async () => {
    const f = fake({ now: ist("13:05"), hours: { opening: "18:00", closing: "02:00" } });
    expect(await runServicePulse(f.ports)).toEqual({ status: "COMPLETE", rowsWritten: 0, summary: { hours_wrap_unsupported: 1 } });
    expect([f.calls.fresh, f.calls.reads, f.written, f.expired]).toEqual([[], [], [], []]);
  });

  it("does nothing before opening", async () => {
    const f = fake({ now: ist("11:20") });
    expect((await runServicePulse(f.ports)).summary).toEqual({ outside_hours: 1 });
    expect(f.calls.reads).toEqual([]);
  });

  it("after closing expires the day's pulse findings with CLOSING_TIME, without needing fresh input", async () => {
    const f = fake({ now: ist("23:20") });
    const result = await runServicePulse(f.ports);
    expect(f.expired).toEqual([
      ["pulse.sales_pace_below", "pulse.no_orders", "pulse.kitchen_slow"].map((rule) => ({
        dedupeKey: `pulse:${rule}:${D}`,
        asOf: "2026-09-11T23:15:00+05:30",
        reason: "CLOSING_TIME",
      })),
    ]);
    expect([f.calls.fresh, result.summary]).toEqual([[], { outside_hours: 1, insights_expired: 3 }]);
  });

  it("counts stale_input and neither fires nor expires when the intraday writer has not run since the bucket ended (C8/U3)", async () => {
    const f = fake({ now: ist("13:05"), fresh: false, ordersLast45: 0 });
    expect(await runServicePulse(f.ports)).toEqual({ status: "COMPLETE", rowsWritten: 0, summary: { stale_input: 1 } });
    expect(f.calls.fresh).toEqual(["2026-09-11T13:00:00+05:30"]);
    expect([f.calls.reads, f.written, f.expired]).toEqual([[], [], []]);
  });

  it("writes a valid DETECTION as of the bucket end, counts orders over the last 45 min, and expires only CLEAR keys", async () => {
    const f = fake({ now: ist("13:05"), ordersLast45: 0 });
    const result = await runServicePulse(f.ports);
    expect(f.calls.counts).toEqual([["2026-09-11T12:15:00+05:30", "2026-09-11T13:00:00+05:30"]]);
    expect(f.calls.reads[0]).toHaveLength(9);

    expect(f.written).toHaveLength(1);
    const insight = InsightSchema.parse(f.written[0]!.insight);
    expect(f.written[0]!.asOf).toBe("2026-09-11T13:00:00+05:30");
    expect(insight).toMatchObject({
      claimType: "DETECTION",
      producer: "detect.pulse",
      dedupeKey: `pulse:pulse.no_orders:${D}`,
      period: { start: "2026-09-11T12:15:00+05:30", end: "2026-09-11T13:00:00+05:30" },
      trust: { state: "NOT_MEASURED" },
      producedBy: { job: PULSE_JOB_NAME, runId: RUN },
      payload: { ruleId: "pulse.no_orders", severity: 3 },
    });
    expect(await hasValidContentHash(insight)).toBe(true);

    // At 13:00 the kitchen window (12:00–13:00) is inside hours and clear; sales pace is not yet 2 h in.
    expect(f.expired.flat().map((r) => r.dedupeKey)).toEqual([`pulse:pulse.kitchen_slow:${D}`]);
    expect(result.summary).toMatchObject({ rules_fired: 1, insight_inserted: 1, insights_expired: 1, "not_evaluated:pulse.sales_pace_below:not_open_long_enough": 1 });
  });
});
