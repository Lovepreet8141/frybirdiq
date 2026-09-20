/**
 * The daily brief's two reads (IQ-2 S10a), on this worktree's own database
 * (hive/tools/test-db.sh):
 *
 * - `loadBriefInsightsFor` returns stored rows for one IST business day, wide
 *   enough for `composeBrief.isForDay` and gated on finance.view;
 * - `readBriefRunState` folds the day's job runs into the three check states
 *   plus the facts and detect summaries.
 *
 * The last case feeds both into `composeBrief` and reads the rendered brief,
 * which is what BUSINESS-INTELLIGENCE's page will do.
 */
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/db";
import { iqJobRuns } from "@/db/schema";
import { runBriefDaily } from "@/lib/iq/brief/brief-job";
import { figuresRead } from "@/lib/iq/brief/__test-support__/brief";
import { composeBrief, parityFromSummary, type BriefInsight } from "@/lib/iq/brief/compose";
import { addDays } from "@/lib/dates";
import { computeContentHash, viewerFor, type InsightOf, type InsightViewer } from "@/lib/iq/engine";
import { createTestOrg, deleteTestOrg, type TestOrg } from "./__test-support__/fixtures";
import { loadBriefInsightsFor, writeInsight, type IqTx, type IqWriteLease } from "./iq-insights";
import { readBriefRunState } from "./iq-job-runs";

const D = "2026-09-11";
const DAY_START = `${D}T00:00:00+05:30`;
const DAY_END = "2026-09-12T00:00:00+05:30";

const OWNER: InsightViewer = viewerFor(["OWNER"]);
const ANALYST: InsightViewer = viewerFor(["ANALYST"]);

let org: TestOrg;

beforeAll(async () => {
  org = await createTestOrg();
});

afterAll(async () => {
  if (org) await deleteTestOrg(org.orgId);
});

type RunStatus = "SUCCEEDED" | "FAILED" | "RUNNING";

/** A run row. A write needs its lease, so a run that will write starts RUNNING and is finished afterwards. */
async function startRun(job: string, periodKey: string, status: RunStatus = "RUNNING", summary: Record<string, number> = {}): Promise<IqWriteLease> {
  const [row] = await db()
    .insert(iqJobRuns)
    .values({
      orgId: org.orgId,
      job,
      periodKey,
      status,
      summary,
      trigger: "TIMER",
      attempt: 1,
      leaseOwner: randomUUID(),
      leaseExpiresAt: sql`now() + interval '5 minutes'`,
      deadlineAt: sql`now() + interval '4 minutes'`,
      codeVersion: "6ad2606",
    })
    .returning({ id: iqJobRuns.id, attempt: iqJobRuns.attempt, leaseOwner: iqJobRuns.leaseOwner });
  if (!row) throw new Error("no run");
  return { orgId: org.orgId, runId: row.id, attempt: row.attempt, leaseOwner: row.leaseOwner };
}

/** Ends a run the way the runner's finish would, so the brief can read how it ended. */
async function finishRun(lease: IqWriteLease, status: RunStatus, summary: Record<string, number> = {}): Promise<void> {
  await db().update(iqJobRuns).set({ status, summary }).where(eq(iqJobRuns.id, lease.runId));
}

const inTx = <T>(work: (tx: IqTx) => Promise<T>) => db().transaction(work);

type DetectionOptions = {
  readonly producer?: string;
  readonly period?: { readonly start: string; readonly end: string };
  readonly dedupeKey?: string;
  readonly templateId?: string;
};

async function detection(lease: IqWriteLease, options: DetectionOptions = {}): Promise<InsightOf<"DETECTION">> {
  const period = options.period ?? { start: DAY_START, end: DAY_END };
  const evidence = [{ kind: "metric" as const, metricId: "revenue_net", period }];
  const payload = {
    ruleId: "sales.below_weekday_baseline",
    observed: { unit: "paise", value: "600000" },
    baseline: { method: "median_mad", value: { unit: "paise", value: "1000000" }, windowWeeks: 8 },
    deviationBps: -4000,
    severity: 3,
  } as InsightOf<"DETECTION">["payload"];
  return {
    id: randomUUID(),
    orgId: org.orgId,
    locationId: null,
    schemaVersion: 1,
    producer: options.producer ?? "detect.baseline",
    subject: { kind: "METRIC", ref: "revenue_net" },
    period,
    dedupeKey: options.dedupeKey ?? `detect:sales.below_weekday_baseline:${randomUUID()}`,
    evidence,
    trust: { state: "MEASURED", score: 95, asOf: "2026-09-12T02:10:00+05:30", metricIds: ["revenue_net"], reasons: ["GRADE_HIGH"] },
    copy: { templateId: options.templateId ?? "detect.sales.below_weekday_baseline", slots: { observed: "observed", baseline: "baseline.value" } },
    status: "ACTIVE",
    producedBy: { job: "iq-detect-daily", runId: lease.runId, attempt: lease.attempt, codeVersion: "6ad2606" },
    contentHash: await computeContentHash({ payload, evidence }),
    supersedes: null,
    createdAt: "2026-09-12T02:45:00+05:30",
    expiresAt: null,
    claimType: "DETECTION",
    payload,
  };
}

/**
 * The five day FACTs the brief needs to be READY, written by the real
 * `runBriefDaily` through `writeInsight` — so the page's loader reads exactly
 * what the brief job stores.
 */
async function seedBriefFacts(date: string, lease: IqWriteLease): Promise<void> {
  const end = `${addDays(date, 1)}T00:00:00+05:30`;
  await runBriefDaily({
    orgId: org.orgId,
    runId: lease.runId,
    attempt: lease.attempt,
    codeVersion: "6ad2606",
    date,
    factsReady: async () => true,
    readFigures: async () => figuresRead(),
    newId: randomUUID,
    now: () => new Date(`${addDays(date, 1)}T02:00:00Z`),
    commit: (write) => inTx((tx) => write({ writeInsight: async (insight) => writeInsight(tx, lease, insight, { asOf: end }) })),
  });
}

const keyOf = (read: { readonly insights: readonly { readonly dedupeKey: string }[] }) => read.insights.map((i) => i.dedupeKey).sort();

describe("loadBriefInsightsFor — the day's window", () => {
  it("keeps the day's own rows and the brief's month-to-date facts, and leaves another day out", async () => {
    const lease = await startRun("iq-detect-daily", randomUUID());
    const sameDay = await detection(lease, { dedupeKey: `detect:same-day:${D}` });
    const otherDay = await detection(lease, {
      dedupeKey: "detect:other-day:2026-09-10",
      period: { start: "2026-09-10T00:00:00+05:30", end: DAY_START },
    });
    // The brief's own comparison FACT: its period is last month, its key ends with the date.
    const lastMonth = await detection(lease, {
      dedupeKey: `brief:fact:revenue_net:same_days_last_month:${D}`,
      period: { start: "2026-08-01T00:00:00+05:30", end: "2026-08-12T00:00:00+05:30" },
    });
    for (const insight of [sameDay, otherDay, lastMonth]) {
      await inTx((tx) => writeInsight(tx, lease, insight, { asOf: DAY_END }));
    }

    const read = await loadBriefInsightsFor(org.orgId, OWNER, D);
    expect(keyOf(read)).toEqual([sameDay.dedupeKey, lastMonth.dedupeKey].sort());
    expect(read.dropped).toBe(0);
  });

  it("keeps a signatures finding whose 48 h window reaches into the day", async () => {
    const lease = await startRun("iq-money-signatures", randomUUID());
    const reachesIn = await detection(lease, {
      producer: "sig.double_capture",
      dedupeKey: `sig:double_capture:${randomUUID()}`,
      // Opened the day before, still covering part of D.
      period: { start: "2026-09-10T06:00:00+05:30", end: `${D}T10:00:00+05:30` },
    });
    await inTx((tx) => writeInsight(tx, lease, reachesIn, { asOf: DAY_END }));

    const owner = await loadBriefInsightsFor(org.orgId, OWNER, D);
    expect(keyOf(owner)).toContain(reachesIn.dedupeKey);
  });

  it("never returns a payment-ledger finding to a viewer without finance.view", async () => {
    const lease = await startRun("iq-reconcile-nightly", randomUUID());
    const ledger = await detection(lease, { producer: "recon.capture_vs_total", dedupeKey: `recon:capture_vs_total:${D}` });
    await inTx((tx) => writeInsight(tx, lease, ledger, { asOf: DAY_END }));

    expect(keyOf(await loadBriefInsightsFor(org.orgId, OWNER, D))).toContain(ledger.dedupeKey);
    expect(keyOf(await loadBriefInsightsFor(org.orgId, ANALYST, D))).not.toContain(ledger.dedupeKey);
  });

  it("returns rows composeBrief can take as they are", async () => {
    const read = await loadBriefInsightsFor(org.orgId, OWNER, D);
    const insights: readonly BriefInsight[] = read.insights;
    expect(insights.length).toBeGreaterThan(0);
    for (const insight of insights) {
      expect(insight.period.start).toMatch(/\+05:30$/);
      expect(typeof insight.dedupeKey).toBe("string");
      expect(insight.supersededBy).toBeNull();
    }
  });
});

describe("readBriefRunState — how the day's checks ran", () => {
  it("reads NOT_RUN for a check with no run, and the summaries only from a run that succeeded", async () => {
    const date = "2026-09-14";
    const state = await readBriefRunState(org.orgId, date);
    expect(state).toEqual({ checks: { detect: "NOT_RUN", reconcile: "NOT_RUN", signatures: "NOT_RUN" }, factsSummary: null, detectSummary: null });
    expect(parityFromSummary(state.factsSummary)).toEqual({ state: "NOT_CHECKED" });

    await startRun("iq-facts-nightly", date, "FAILED", { parity_checks: 1, parity_mismatches: 0, parity_missing_days: 0 });
    expect((await readBriefRunState(org.orgId, date)).factsSummary).toBeNull();
  });

  it("folds a day's runs: detect succeeded, reconcile failed, an hourly check counts every hour", async () => {
    const date = "2026-09-15";
    await startRun("iq-detect-daily", date, "SUCCEEDED", { "not_evaluated:detect.waste.spike:no_waste_recorded": 1 });
    await startRun("iq-facts-nightly", date, "SUCCEEDED", { parity_checks: 3, parity_mismatches: 0, parity_missing_days: 0 });
    await startRun("iq-reconcile-nightly", date, "FAILED");
    await startRun("iq-money-signatures", `${date}T09`, "SUCCEEDED");
    await startRun("iq-money-signatures", `${date}T10`, "SUCCEEDED");

    const state = await readBriefRunState(org.orgId, date);
    expect(state.checks).toEqual({ detect: "SUCCEEDED", reconcile: "FAILED", signatures: "SUCCEEDED" });
    expect(state.detectSummary).toEqual({ "not_evaluated:detect.waste.spike:no_waste_recorded": 1 });
    expect(parityFromSummary(state.factsSummary)).toEqual({ state: "CHECKED", matched: true });

    // One hour still running: the check has not finished the day, so it is not an all-clear.
    await startRun("iq-money-signatures", `${date}T11`, "RUNNING");
    expect((await readBriefRunState(org.orgId, date)).checks.signatures).toBe("NOT_RUN");
  });

  it("does not see another org's runs", async () => {
    const other = await createTestOrg();
    try {
      const date = "2026-09-16";
      await db()
        .insert(iqJobRuns)
        .values({
          orgId: other.orgId,
          job: "iq-detect-daily",
          periodKey: date,
          status: "SUCCEEDED",
          trigger: "TIMER",
          attempt: 1,
          leaseOwner: randomUUID(),
          leaseExpiresAt: sql`now() + interval '5 minutes'`,
          deadlineAt: sql`now() + interval '4 minutes'`,
          codeVersion: "6ad2606",
        });
      expect((await readBriefRunState(org.orgId, date)).checks.detect).toBe("NOT_RUN");
      expect((await readBriefRunState(other.orgId, date)).checks.detect).toBe("SUCCEEDED");
    } finally {
      await deleteTestOrg(other.orgId);
    }
  });
});

describe("a date that is not a date (RELIABILITY, iq2-s10a fix)", () => {
  it("refuses a LIKE wildcard instead of matching another day's rows", async () => {
    const date = "2026-09-15";
    // The day this wildcard would reach: its runs succeeded, and a brief must never report them as another day's.
    expect((await readBriefRunState(org.orgId, date)).checks.detect).toBe("SUCCEEDED");

    await expect(readBriefRunState(org.orgId, "2026-09-1_")).rejects.toThrow(RangeError);
    await expect(loadBriefInsightsFor(org.orgId, OWNER, "2026-09-1_")).rejects.toThrow(RangeError);
    await expect(readBriefRunState(org.orgId, "2026-09-1%")).rejects.toThrow(RangeError);
  });

  it("refuses a date that does not exist and one of the wrong shape", async () => {
    for (const bad of ["2026-02-30", "2026-9-15", "15-09-2026", ""]) {
      await expect(readBriefRunState(org.orgId, bad)).rejects.toThrow(RangeError);
      await expect(loadBriefInsightsFor(org.orgId, OWNER, bad)).rejects.toThrow(RangeError);
    }
  });
});

describe("both reads, composed", () => {
  it("renders a brief for the day from stored rows and the day's run state", async () => {
    const date = "2026-09-17";
    const start = `${date}T00:00:00+05:30`;
    const end = "2026-09-18T00:00:00+05:30";
    const lease = await startRun("iq-detect-daily", date);
    await seedBriefFacts(date, lease);
    const finding = await detection(lease, { dedupeKey: `detect:sales.below_weekday_baseline:${date}`, period: { start, end } });
    await inTx((tx) => writeInsight(tx, lease, finding, { asOf: end }));
    await finishRun(lease, "SUCCEEDED");

    const [read, runState] = await Promise.all([loadBriefInsightsFor(org.orgId, OWNER, date), readBriefRunState(org.orgId, date)]);
    const brief = composeBrief({
      date,
      // A stored row's created_at is the database's now(), so the read time is now too.
      readAt: new Date(),
      viewer: OWNER,
      insights: read.insights,
      checks: runState.checks,
      parity: parityFromSummary(runState.factsSummary),
      detectSummary: runState.detectSummary,
    });

    expect(brief.state).toBe("READY");
    expect(brief.yesterday.lines.map((line) => line.text).join(" ")).toContain("Net sales (excl. GST):");
    const text = [...brief.risks.lines, ...brief.worthKnowing.lines].map((line) => line.text).join(" ");
    expect(text).toContain("Net sales were");
    expect(brief.risks.lines.flatMap((line) => line.insightIds)).toContain(finding.id);
  });
});

describe("pulse.no_orders gets its own sentence (S10a item c)", () => {
  it("renders the gap's times from the insight's period, not a rule id", async () => {
    const date = "2026-09-18";
    const lease = await startRun("iq-service-pulse", `${date}T14`);
    await seedBriefFacts(date, lease);
    const gap = { start: `${date}T14:15:00+05:30`, end: `${date}T15:00:00+05:30` };
    const noOrders = await detection(lease, {
      producer: "pulse.service",
      dedupeKey: `pulse:pulse.no_orders:${date}`,
      period: gap,
      templateId: "pulse.no_orders",
    });
    await inTx((tx) => writeInsight(tx, lease, noOrders, { asOf: gap.end }));
    await finishRun(lease, "SUCCEEDED");

    const read = await loadBriefInsightsFor(org.orgId, OWNER, date);
    const brief = composeBrief({
      date,
      // A stored row's created_at is the database's now(), so the read time is now too.
      readAt: new Date(),
      viewer: OWNER,
      insights: read.insights,
      checks: { detect: "SUCCEEDED", reconcile: "SUCCEEDED", signatures: "SUCCEEDED" },
      parity: { state: "CHECKED", matched: true },
      detectSummary: null,
    });
    const text = [...brief.risks.lines, ...brief.worthKnowing.lines].map((line) => line.text).join(" ");
    expect(text).toContain("No orders came in between");
    expect(text).not.toContain("pulse.no_orders");
  });
});
