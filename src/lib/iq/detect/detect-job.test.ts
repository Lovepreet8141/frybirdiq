import { describe, expect, it } from "vitest";

import { InsightSchema, hasValidContentHash, type Observed } from "@/lib/iq/engine";
import { observed } from "@/lib/iq/engine/observed-factory";

import { D, history, type DayOptions } from "./__test-support__/days";
import { DETECT_JOB_NAME, detectReadDates, istTimestamp, runDetectDaily, type DetectJobPorts, type ExpireRequest } from "./detect-job";
import type { DetectDay } from "./rules";

const RUN = "22222222-2222-4222-8222-222222222222";
const ORG = "11111111-1111-4111-8111-111111111111";

function fakePorts(days: DetectDay[], options: { factsReady?: boolean; target?: Observed | null; excludedDates?: string[] } = {}) {
  const written: unknown[] = [];
  const expired: ExpireRequest[][] = [];
  const reads: (readonly string[])[] = [];
  let n = 0;
  const ports: DetectJobPorts = {
    orgId: ORG,
    runId: RUN,
    attempt: 1,
    codeVersion: "48c428a",
    date: D,
    ...(options.excludedDates ? { excludedDates: options.excludedDates } : {}),
    factsReady: async () => options.factsReady ?? true,
    readDays: async (dates) => {
      reads.push(dates);
      return days.filter((d) => dates.includes(d.date));
    },
    readFoodCostTarget: async () => options.target ?? null,
    newId: () => `aaaaaaaa-0000-4000-8000-${String(++n).padStart(12, "0")}`,
    now: () => new Date("2026-09-11T21:15:00Z"),
    commit: async (write) =>
      write({
        writeInsight: async (insight) => {
          written.push(insight);
          return { outcome: "INSERTED" };
        },
        expireInsights: async (requests) => {
          expired.push([...requests]);
          return { expired: requests.length };
        },
      }),
  };
  return { ports, written, expired, reads };
}

const run = (today: DayOptions, extra: Parameters<typeof fakePorts>[1] = {}) => {
  const fake = fakePorts(history(today), extra);
  return { fake, result: runDetectDaily(fake.ports) };
};

describe("runDetectDaily", () => {
  it("refuses to run before the day's facts are ready (UPSTREAM_NOT_READY), reading and writing nothing", async () => {
    const { fake, result } = run({}, { factsReady: false });
    await expect(result).rejects.toMatchObject({ code: "UPSTREAM_NOT_READY" });
    expect([fake.reads, fake.written, fake.expired]).toEqual([[], [], []]);
  });

  it("reads the day, the day before and the 8 baseline days", async () => {
    const { fake, result } = run({});
    await result;
    expect(fake.reads).toEqual([detectReadDates(D)]);
    expect(detectReadDates(D)).toHaveLength(10);
  });

  it("writes each detection as a valid DETECTION insight with a correct content hash", async () => {
    const { fake, result } = run({ values: { revenue_net: 600000n } });
    const outcome = await result;
    expect(fake.written).toHaveLength(1);
    const insight = InsightSchema.parse(fake.written[0]);
    expect(insight).toMatchObject({
      claimType: "DETECTION",
      orgId: ORG,
      producer: "detect.baseline",
      dedupeKey: `detect:sales.below_weekday_baseline:${D}`,
      subject: { kind: "METRIC", ref: "revenue_net" },
      period: { start: `${D}T00:00:00+05:30`, end: "2026-09-12T00:00:00+05:30" },
      producedBy: { job: DETECT_JOB_NAME, runId: RUN, attempt: 1, codeVersion: "48c428a" },
      trust: { state: "MEASURED", score: 95, metricIds: ["revenue_net"], reasons: ["GRADE_HIGH", "T1_RECIPE_COVERAGE"] },
      payload: { ruleId: "sales.below_weekday_baseline", severity: 3, deviationBps: -4000 },
      createdAt: "2026-09-12T02:45:00+05:30",
    });
    expect(insight.evidence).toHaveLength(2);
    expect(await hasValidContentHash(insight)).toBe(true);
    expect(outcome).toMatchObject({ status: "COMPLETE", summary: { rules_fired: 1, insight_inserted: 1 } });
  });

  it("expires only the keys that evaluated CLEAR, as of the end of the day", async () => {
    const { fake, result } = run({ values: { revenue_net: 600000n }, grades: { waste_cost: "LOW" } });
    const outcome = await result;
    const keys = fake.expired.flat().map((r) => r.dedupeKey);
    expect(keys).toContain(`detect:discount.spike:${D}`);
    expect(keys).not.toContain(`detect:sales.below_weekday_baseline:${D}`); // fired
    expect(keys).not.toContain(`detect:waste.spike:${D}`); // LOW trust while silent: not evaluated
    expect(keys).not.toContain(`detect:food_cost.above_target:${D}`); // no target
    expect(fake.expired.flat().every((r) => r.asOf === "2026-09-12T00:00:00+05:30" && r.reason === "CLEARED")).toBe(true);
    expect(outcome.summary.insights_expired).toBe(keys.length);
  });

  it("on a closed day writes nothing and expires nothing", async () => {
    const { fake, result } = run({ values: { orders_paid: 0n } });
    const outcome = await result;
    expect([fake.written, fake.expired]).toEqual([[], []]);
    expect(outcome).toMatchObject({ status: "COMPLETE", rowsWritten: 0 });
  });

  it("passes owner-excluded dates through, and treats the date itself as not evaluated", async () => {
    const { fake, result } = run({ values: { revenue_net: 600000n } }, { excludedDates: [D] });
    await result;
    expect([fake.written, fake.expired]).toEqual([[], []]);
  });

  it("writes a capped LOW-trust detection with INSUFFICIENT_DATA when the grade is UNKNOWN", async () => {
    const { fake, result } = run({ values: { revenue_net: 600000n }, grades: { revenue_net: "UNKNOWN" } });
    await result;
    const insight = InsightSchema.parse(fake.written.find((w) => (w as { dedupeKey: string }).dedupeKey.includes("sales.below")));
    expect(insight.trust).toEqual({ state: "INSUFFICIENT_DATA", reasons: ["GRADE_UNKNOWN", "T1_RECIPE_COVERAGE", "CAPPED_LOW_TRUST"] });
    expect(insight.payload).toMatchObject({ severity: 1 });
  });

  it("uses a stored food-cost target when one exists", async () => {
    const { fake, result } = run({ values: { food_cost_pct_theoretical: 3200n } }, { target: observed({ unit: "bps", value: 3000 }) });
    await result;
    expect(fake.written.map((w) => (w as { dedupeKey: string }).dedupeKey)).toContain(`detect:food_cost.above_target:${D}`);
  });

  it("formats timestamps in IST with an explicit offset", () => {
    expect(istTimestamp(new Date("2026-09-11T20:30:00Z"))).toBe("2026-09-12T02:00:00+05:30");
  });
});
