import { describe, expect, it } from "vitest";

import { InsightSchema, hasValidContentHash, type InsightOf } from "@/lib/iq/engine";
import { observed } from "@/lib/iq/engine/observed-factory";

import { DATE, ORG, RUN, figuresRead, nextId, trust } from "./__test-support__/brief";
import { BRIEF_FIGURE_UNITS, UpstreamNotReady, briefPeriods, runBriefDaily, type BriefFiguresRead, type BriefJobPorts } from "./brief-job";
import { BRIEF_JOB_NAME, BRIEF_PRODUCER } from "./keys";

function fakePorts(read: BriefFiguresRead, options: { factsReady?: boolean; outcome?: string; openedOn?: string | null } = {}) {
  const written: InsightOf<"FACT">[] = [];
  const asOfs: string[] = [];
  let commits = 0;
  const ports: BriefJobPorts = {
    orgId: ORG,
    runId: RUN,
    attempt: 2,
    codeVersion: "93fd9c5",
    date: DATE,
    openedOn: options.openedOn ?? null,
    factsReady: async () => options.factsReady ?? true,
    readFigures: async () => read,
    newId: nextId,
    now: () => new Date("2026-09-12T02:00:00Z"),
    commit: async (write) => {
      commits += 1;
      return write({
        writeInsight: async (insight, { asOf }) => {
          written.push(insight);
          asOfs.push(asOf);
          return { outcome: options.outcome ?? "INSERTED" };
        },
      });
    },
  };
  return { ports, written, asOfs, commits: () => commits };
}

describe("briefPeriods", () => {
  it("takes the month to date and the same days last month", () => {
    expect(briefPeriods("2026-09-11")).toEqual({
      day: { from: "2026-09-11", to: "2026-09-11" },
      monthToDate: { from: "2026-09-01", to: "2026-09-11" },
      sameDaysLastMonth: { from: "2026-08-01", to: "2026-08-11", clamped: false },
    });
  });

  it("clamps to a shorter previous month, leap years included, and crosses the year", () => {
    expect(briefPeriods("2026-03-31").sameDaysLastMonth).toEqual({ from: "2026-02-01", to: "2026-02-28", clamped: true });
    expect(briefPeriods("2028-03-30").sameDaysLastMonth).toEqual({ from: "2028-02-01", to: "2028-02-29", clamped: true });
    expect(briefPeriods("2026-05-31").sameDaysLastMonth).toEqual({ from: "2026-04-01", to: "2026-04-30", clamped: true });
    expect(briefPeriods("2026-01-15")).toMatchObject({ monthToDate: { from: "2026-01-01" }, sameDaysLastMonth: { from: "2025-12-01", to: "2025-12-15", clamped: false } });
    expect(briefPeriods("2026-09-01").monthToDate).toEqual({ from: "2026-09-01", to: "2026-09-01" });
  });

  describe("analytics-start-date: openedOn clamps out pre-launch days", () => {
    it("with no Opening date, behaves exactly as before", () => {
      expect(briefPeriods("2026-09-11", null)).toEqual(briefPeriods("2026-09-11"));
    });

    it("moves monthToDate's start up to the Opening date when the month started before it", () => {
      expect(briefPeriods("2026-09-11", "2026-09-05").monthToDate).toEqual({ from: "2026-09-05", to: "2026-09-11" });
    });

    it("drops sameDaysLastMonth entirely (zero days) when that whole span predates the Opening date", () => {
      const { sameDaysLastMonth } = briefPeriods("2026-09-11", "2026-09-01");
      expect(sameDaysLastMonth.from > sameDaysLastMonth.to).toBe(true);
    });

    it("does not clamp a period that is already entirely after the Opening date", () => {
      expect(briefPeriods("2026-09-11", "2026-01-01").monthToDate).toEqual({ from: "2026-09-01", to: "2026-09-11" });
    });
  });
});

describe("runBriefDaily", () => {
  it("refuses before reading anything when the day's facts are not final", async () => {
    const fake = fakePorts(figuresRead(), { factsReady: false });
    await expect(runBriefDaily(fake.ports)).rejects.toBeInstanceOf(UpstreamNotReady);
    expect(fake.commits()).toBe(0);
  });

  it("writes seven FACTs in one chunk, each a valid insight with its trust and period", async () => {
    const fake = fakePorts(figuresRead({ trust: { food_cost_pct_theoretical: trust("LOW", "t1_recipe_coverage") } }));
    const result = await runBriefDaily(fake.ports);

    expect(fake.commits()).toBe(1);
    expect(result).toMatchObject({ status: "COMPLETE", rowsWritten: 7, summary: { facts_planned: 7, figures_missing: 0, insight_inserted: 7 } });
    expect(fake.written.map((i) => i.dedupeKey)).toEqual([
      "brief:fact:revenue_net:2026-09-11",
      "brief:fact:orders_paid:2026-09-11",
      "brief:fact:aov_net:2026-09-11",
      "brief:fact:food_cost_pct_theoretical:2026-09-11",
      "brief:fact:net_collected:2026-09-11",
      "brief:fact:revenue_net:month_to_date:2026-09-11",
      "brief:fact:revenue_net:same_days_last_month:2026-09-11",
    ]);
    expect(fake.asOfs.every((a) => a === "2026-09-12T00:00:00+05:30")).toBe(true);

    for (const insight of fake.written) {
      expect(InsightSchema.safeParse(insight).success).toBe(true);
      expect(await hasValidContentHash(insight)).toBe(true);
      expect(insight).toMatchObject({ claimType: "FACT", producer: BRIEF_PRODUCER, producedBy: { job: BRIEF_JOB_NAME, runId: RUN, attempt: 2 }, orgId: ORG });
      expect(insight.copy.slots).toEqual({ value: "value" });
    }

    const [revenue, , , food, , mtd, previous] = fake.written;
    expect(revenue).toMatchObject({
      period: { start: "2026-09-11T00:00:00+05:30", end: "2026-09-12T00:00:00+05:30" },
      copy: { templateId: "brief.fact.revenue_net" },
      trust: { state: "MEASURED", score: 95, metricIds: ["revenue_net"], reasons: ["GRADE_HIGH"] },
      payload: { metricId: "revenue_net", value: { unit: "paise", value: "1000000" }, sourceQueryId: "iq_daily_facts.sum" },
    });
    expect(food?.trust).toMatchObject({ reasons: ["GRADE_LOW", "T1_RECIPE_COVERAGE"] });
    expect(mtd).toMatchObject({ period: { start: "2026-09-01T00:00:00+05:30", end: "2026-09-12T00:00:00+05:30" }, copy: { templateId: "brief.fact.revenue_net.month_to_date" } });
    expect(previous).toMatchObject({ period: { start: "2026-08-01T00:00:00+05:30", end: "2026-08-12T00:00:00+05:30" } });
  });

  it("counts a missing figure and writes the rest", async () => {
    const fake = fakePorts(figuresRead({ aov_net: null, sameDaysLastMonth: null }));
    const result = await runBriefDaily(fake.ports);
    expect(fake.written).toHaveLength(5);
    expect(result.summary).toMatchObject({ figures_missing: 2, "figure_missing:aov_net": 1, "figure_missing:revenue_net:same_days_last_month": 1 });
  });

  it("does not count a NOOP or STALE_WRITE as a row written", async () => {
    const result = await runBriefDaily(fakePorts(figuresRead(), { outcome: "NOOP" }).ports);
    expect(result).toMatchObject({ rowsWritten: 0, summary: { insight_noop: 7 } });
    expect((await runBriefDaily(fakePorts(figuresRead(), { outcome: "STALE_WRITE" }).ports)).rowsWritten).toBe(0);
  });

  it("refuses a figure in the wrong unit", async () => {
    const read = figuresRead();
    const wrong: BriefFiguresRead = { ...read, day: { ...read.day, orders_paid: { value: observed({ unit: "paise", value: "40" }), trust: trust() } } };
    await expect(runBriefDaily(fakePorts(wrong).ports)).rejects.toThrow(/orders_paid must be count/);
    expect(BRIEF_FIGURE_UNITS.orders_paid).toBe("count");
  });

  describe("analytics-start-date: a pre-launch day plans no day-window facts", () => {
    it("skips all five day-window metrics when the day is before the Opening date, but still plans the month spans", async () => {
      const fake = fakePorts(figuresRead(), { openedOn: "2026-09-12" }); // DATE (2026-09-11) is the day before opening
      const result = await runBriefDaily(fake.ports);
      expect(fake.commits()).toBe(1);
      expect(result).toMatchObject({ status: "COMPLETE", rowsWritten: 2, summary: { facts_planned: 2, figures_missing: 0, pre_launch_day: 1 } });
      expect(fake.written.map((i) => i.dedupeKey)).toEqual(["brief:fact:revenue_net:month_to_date:2026-09-11", "brief:fact:revenue_net:same_days_last_month:2026-09-11"]);
    });

    it("plans every fact as normal with no Opening date, or once the day is on or after it", async () => {
      expect((await runBriefDaily(fakePorts(figuresRead()).ports)).rowsWritten).toBe(7);
      expect((await runBriefDaily(fakePorts(figuresRead(), { openedOn: DATE }).ports)).rowsWritten).toBe(7);
      expect((await runBriefDaily(fakePorts(figuresRead(), { openedOn: "2026-09-01" }).ports)).rowsWritten).toBe(7);
    });
  });
});
