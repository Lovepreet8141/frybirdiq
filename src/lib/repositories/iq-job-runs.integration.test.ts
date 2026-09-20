/**
 * iq-job-runs.ts against the real local Supabase stack — the fencing and
 * claim guarantees the pure runner relies on (src/lib/jobs/fence.ts C1-C4,
 * RELIABILITY J3):
 *
 * - concurrent claims insert one row;
 * - a chunk and its cursor commit together, and a fenced-out chunk writes nothing;
 * - C1: a takeover waits behind an open chunk and then matches nothing;
 * - zombie run: a stalled attempt loses its lease to a takeover and cannot
 *   commit, heartbeat or finish afterwards;
 * - closeZombie counts the lost lease and ignores a live one;
 * - finish outcomes, and a heartbeat after finish hits nothing (C2);
 * - heavy-job exclusion; org isolation; one heartbeat request end to end.
 */
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/db";
import { iqInsights, iqJobRuns } from "@/db/schema";
import { computeContentHash, type InsightOf } from "@/lib/iq/engine";
import { JOB_HOST } from "@/lib/jobs/auth";
import { decideClaim } from "@/lib/jobs/claim-decision";
import { LeaseLostError, type LeaseToken } from "@/lib/jobs/fence";
import type { JobContext, JobRunResult } from "@/lib/jobs/context";
import { handleJobRequest, type ClaimRequest } from "@/lib/jobs/handle";
import { DEFAULT_TIMING, type JobDefinition } from "@/lib/jobs/registry";
import { nightlyDates, remainingAfter } from "@/lib/jobs/facts-plan";
import { periodKeyAt, shiftPeriod } from "@/lib/jobs/period";
import { auditLogs, iqDailyFacts, iqDailyTrust, orderEvents, orders, organizations, payments, refunds } from "@/db/schema";
import { CASH_PROVIDER } from "@/lib/payments";
import { fromRupees } from "@/lib/money";
import { refundPayment } from "./payments";
import { createTestOrg, deleteTestOrg, type TestOrg } from "./__test-support__/fixtures";
import { seedExpense } from "./__test-support__/iq-fixtures";
import { factDayLockKey, intradayDayLockKey, readDailyFacts } from "./iq-facts";
import { history } from "@/lib/iq/detect/__test-support__/days";
import { detectionInsight, istDayStart, istTimestamp } from "@/lib/iq/detect/detect-job";
import { evaluateDetectDay, type RuleOutcome } from "@/lib/iq/detect/rules";
import { addDays, startOfBusinessDay } from "@/lib/iq/metrics";
import { JOB_REGISTRY } from "@/lib/jobs/registry";
import type { JobWriteRepos } from "@/lib/jobs/repos";
import { createJobRunStore, iqRepos } from "./iq-job-runs";
import { jobRouteDeps } from "@/app/api/jobs/[job]/deps";
import { POST } from "@/app/api/jobs/[job]/route";

const PERIOD = "2026-09-17T10";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const store = () => createJobRunStore({ codeVersion: "test-sha", heavyJobs: ["heavy_a", "heavy_b"] });

let org: TestOrg;
let otherOrg: TestOrg;

beforeAll(async () => {
  org = await createTestOrg();
  otherOrg = await createTestOrg();
});

afterAll(async () => {
  await deleteTestOrg(org.orgId);
  await deleteTestOrg(otherOrg.orgId);
});

const claimRequest = (overrides: Partial<ClaimRequest> = {}): ClaimRequest => ({
  job: `test_${randomUUID().slice(0, 8)}`,
  orgId: org.orgId,
  periodKey: PERIOD,
  trigger: "TIMER",
  leaseOwner: randomUUID(),
  leaseSeconds: 300,
  deadlineSeconds: 240,
  ...overrides,
});

const tokenOf = (row: { id: string; attempt: number }, leaseOwner: string): LeaseToken => ({
  runId: row.id,
  attempt: row.attempt,
  leaseOwner,
});

const stored = async (id: string) => (await db().select().from(iqJobRuns).where(eq(iqJobRuns.id, id)))[0]!;

const HOUR_MS = 3600_000;
const ist = (date: Date) => `${new Date(date.getTime() + 5.5 * HOUR_MS).toISOString().slice(0, 19)}+05:30`;

/** A valid FACT insight for `target`, produced by the run `token` names, keyed by `dedupeKey`. */
async function factFor(target: TestOrg, token: LeaseToken, dedupeKey: string): Promise<InsightOf<"FACT">> {
  const now = new Date();
  const period = { start: ist(new Date(now.getTime() - 24 * HOUR_MS)), end: ist(now) };
  const draft = {
    id: randomUUID(),
    orgId: target.orgId,
    locationId: target.locationId,
    schemaVersion: 1 as const,
    producer: "test-job",
    subject: { kind: "METRIC" as const, ref: "revenue.net" },
    period,
    dedupeKey,
    evidence: [{ kind: "metric" as const, metricId: "revenue.net", period }],
    trust: { state: "NOT_MEASURED" as const },
    copy: { templateId: "test", slots: {} },
    status: "ACTIVE" as const,
    producedBy: { job: "test-job", runId: token.runId, attempt: token.attempt, codeVersion: "abc1234" },
    supersedes: null,
    createdAt: ist(now),
    expiresAt: null,
    claimType: "FACT" as const,
    payload: { metricId: "revenue.net", value: { unit: "paise", value: "100" }, sourceQueryId: "orders.net-revenue" },
  };
  const contentHash = await computeContentHash({ payload: draft.payload, evidence: draft.evidence } as never);
  return { ...draft, contentHash } as unknown as InsightOf<"FACT">;
}

/** A chunk write through the job's own writers: one FACT insight keyed by `marker`, so a rollback is visible. */
const insightWrite = (marker: string, token: LeaseToken, target: () => TestOrg = () => org) => async (repos: JobWriteRepos) => {
  const insight = await factFor(target(), token, marker);
  await repos.writeInsight(insight, { asOf: insight.period.end });
};
const insightCount = async (marker: string) =>
  (await db().select({ id: iqInsights.id }).from(iqInsights).where(eq(iqInsights.dedupeKey, marker))).length;

const isLeaseLost = async (promise: Promise<unknown>) => {
  try {
    await promise;
    return false;
  } catch (error) {
    return error instanceof LeaseLostError;
  }
};

describe("claim", () => {
  it("inserts once, then returns the existing row", async () => {
    const s = store();
    const request = claimRequest();
    const first = await s.claim(request);
    expect(first).toMatchObject({ inserted: true, row: { status: "RUNNING", attempt: 1, failures: 0, leaseOwner: request.leaseOwner, cursor: null } });
    const second = await s.claim({ ...request, leaseOwner: randomUUID() });
    expect(second).toMatchObject({ inserted: false, row: { id: first.row.id, leaseOwner: request.leaseOwner } });

    const row = await stored(first.row.id);
    expect(row).toMatchObject({ codeVersion: "test-sha", trigger: "TIMER", orgId: org.orgId });
    const leaseMs = row.leaseExpiresAt.getTime() - row.startedAt.getTime();
    const deadlineMs = row.deadlineAt.getTime() - row.startedAt.getTime();
    expect(Math.round(leaseMs / 1000)).toBe(300);
    expect(Math.round(deadlineMs / 1000)).toBe(240);
  });

  it("lets exactly one of many concurrent claims insert", async () => {
    const request = claimRequest();
    const results = await Promise.all(Array.from({ length: 8 }, () => store().claim({ ...request, leaseOwner: randomUUID() })));
    expect(results.filter((r) => r.inserted)).toHaveLength(1);
    expect(new Set(results.map((r) => r.row.id)).size).toBe(1);
  });

  it("keeps orgs apart: the same job and period is a separate row per org", async () => {
    const s = store();
    const request = claimRequest();
    const a = await s.claim(request);
    const b = await s.claim({ ...request, orgId: otherOrg.orgId });
    expect(b.inserted).toBe(true);
    expect(b.row.id).not.toBe(a.row.id);
  });
});

describe("fence", () => {
  it("commits a chunk and its cursor together, extending the lease", async () => {
    const s = store();
    const request = claimRequest({ leaseSeconds: 5 });
    const { row } = await s.claim(request);
    const before = await stored(row.id);
    await s.commit(tokenOf(row, request.leaseOwner), 300, insightWrite(`ok-${row.id}`, tokenOf(row, request.leaseOwner)), "after-1");
    const after = await stored(row.id);
    expect(after.cursor).toBe("after-1");
    expect(after.heartbeatAt).toBeInstanceOf(Date);
    expect(after.leaseExpiresAt.getTime()).toBeGreaterThan(before.leaseExpiresAt.getTime());
    expect(await insightCount(`ok-${row.id}`)).toBe(1);
  });

  it("rolls back a fenced-out chunk: wrong owner, wrong attempt, or a run this store never claimed", async () => {
    const s = store();
    const request = claimRequest();
    const { row } = await s.claim(request);
    const marker = `fenced-${row.id}`;
    expect(await isLeaseLost(s.commit(tokenOf(row, randomUUID()), 300, insightWrite(marker, tokenOf(row, request.leaseOwner)), "x"))).toBe(true);
    expect(await isLeaseLost(s.commit({ ...tokenOf(row, request.leaseOwner), attempt: 2 }, 300, insightWrite(marker, tokenOf(row, request.leaseOwner))))).toBe(true);
    expect(await isLeaseLost(store().commit(tokenOf(row, request.leaseOwner), 300, insightWrite(marker, tokenOf(row, request.leaseOwner))))).toBe(true);
    expect(await insightCount(marker)).toBe(0);
    expect((await stored(row.id)).cursor).toBeNull();
  });

  it("rolls back the chunk and keeps the old cursor when the write itself fails", async () => {
    const s = store();
    const request = claimRequest();
    const { row } = await s.claim(request);
    await expect(
      s.commit(tokenOf(row, request.leaseOwner), 300, async () => {
        throw new Error("write failed");
      }, "never"),
    ).rejects.toThrow("write failed");
    expect((await stored(row.id)).cursor).toBeNull();
  });

  it("C1: a takeover waits behind an open chunk and then matches nothing", async () => {
    const a = store();
    const b = store();
    const request = claimRequest({ leaseSeconds: 1 });
    const { row } = await a.claim(request);
    const seenByB = await b.claim({ ...request, leaseOwner: randomUUID() });

    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let chunkStarted!: () => void;
    const started = new Promise<void>((resolve) => (chunkStarted = resolve));
    const chunk = a.commit(tokenOf(row, request.leaseOwner), 60, async (repos) => {
      chunkStarted();
      await gate;
      await insightWrite(`c1-${row.id}`, tokenOf(row, request.leaseOwner))(repos);
    });
    await started;
    await sleep(1200); // the lease B last read has now expired in wall time

    const decision = decideClaim(seenByB, 3, new Date(Date.now()));
    expect(decision.kind).toBe("TAKEOVER");
    if (decision.kind !== "TAKEOVER") return;
    const takeover = b.takeover(decision.expected, {
      attempt: decision.nextAttempt,
      failures: decision.nextFailures,
      leaseOwner: randomUUID(),
      trigger: "TIMER",
      leaseSeconds: 300,
      deadlineSeconds: 240,
    });
    const raced = await Promise.race([takeover.then(() => "done"), sleep(300).then(() => "waiting")]);
    expect(raced).toBe("waiting");

    release();
    await chunk;
    expect(await takeover).toBeNull();
    expect(await stored(row.id)).toMatchObject({ attempt: 1, leaseOwner: request.leaseOwner, status: "RUNNING" });
    expect(await insightCount(`c1-${row.id}`)).toBe(1);
  });
});

describe("zombie run", () => {
  it("a stalled attempt loses its lease to a takeover and can no longer commit, heartbeat or finish", async () => {
    const a = store();
    const b = store();
    const request = claimRequest({ leaseSeconds: 1 });
    const { row } = await a.claim(request);
    const tokenA = tokenOf(row, request.leaseOwner);
    await sleep(1200);

    const read = await b.claim({ ...request, leaseOwner: randomUUID() });
    const decision = decideClaim(read, 3, await b.dbNow());
    expect(decision).toMatchObject({ kind: "TAKEOVER", nextAttempt: 2, nextFailures: 1 });
    if (decision.kind !== "TAKEOVER") return;
    const ownerB = randomUUID();
    const taken = await b.takeover(decision.expected, {
      attempt: 2,
      failures: 1,
      leaseOwner: ownerB,
      trigger: "CATCHUP",
      leaseSeconds: 300,
      deadlineSeconds: 240,
    });
    expect(taken).toMatchObject({ status: "RUNNING", attempt: 2, failures: 1, leaseOwner: ownerB });

    const marker = `zombie-${row.id}`;
    expect(await isLeaseLost(a.commit(tokenA, 300, insightWrite(marker, tokenA)))).toBe(true);
    expect(await isLeaseLost(a.heartbeat(tokenA, 300))).toBe(true);
    expect(await isLeaseLost(a.finish(tokenA, { status: "SUCCEEDED", rowsWritten: 9, summary: {} }))).toBe(true);
    expect(await insightCount(marker)).toBe(0);

    const tokenB = tokenOf(taken!, ownerB);
    await b.commit(tokenB, 300, insightWrite(`${marker}-b`, tokenB));
    await b.finish(tokenB, { status: "SUCCEEDED", rowsWritten: 1, summary: { chunks: 1 } });
    expect(await stored(row.id)).toMatchObject({ status: "SUCCEEDED", attempt: 2, trigger: "CATCHUP", rowsWritten: 1 });
    expect(await insightCount(`${marker}-b`)).toBe(1);
  });

  it("closeZombie fails an expired RUNNING row and counts it, but leaves a live one alone (J3)", async () => {
    const s = store();
    const live = claimRequest();
    const liveRun = await s.claim(live);
    await s.closeZombie({ id: liveRun.row.id, status: "RUNNING", attempt: 1, leaseOwner: live.leaseOwner });
    expect(await stored(liveRun.row.id)).toMatchObject({ status: "RUNNING", failures: 0 });

    const dead = claimRequest({ leaseSeconds: 1 });
    const deadRun = await s.claim(dead);
    await sleep(1200);
    await s.closeZombie({ id: deadRun.row.id, status: "RUNNING", attempt: 1, leaseOwner: dead.leaseOwner });
    expect(await stored(deadRun.row.id)).toMatchObject({ status: "FAILED", errorCode: "LEASE_EXPIRED", failures: 1 });
  });
});

describe("finish", () => {
  it("records DEADLINE with its cursor, allows an immediate takeover, then SUCCEEDED clears the cursor; a late heartbeat hits nothing (C2)", async () => {
    const s = store();
    const request = claimRequest();
    const { row } = await s.claim(request);
    const token = tokenOf(row, request.leaseOwner);
    await s.commit(token, 300, async () => undefined, "after-3");
    await s.finish(token, { status: "DEADLINE", errorCode: "DEADLINE", rowsWritten: 3, summary: { chunks: 3 }, cursor: "after-3", failures: 0 });
    const cut = await stored(row.id);
    expect(cut).toMatchObject({ status: "FAILED", errorCode: "DEADLINE", cursor: "after-3", failures: 0, rowsWritten: 3 });
    expect(cut.finishedAt).toBeInstanceOf(Date);
    expect(cut.durationMs).toBeGreaterThanOrEqual(0);
    expect(await isLeaseLost(s.heartbeat(token, 300))).toBe(true);

    const read = await s.claim({ ...request, leaseOwner: randomUUID() });
    const decision = decideClaim(read, 3, await s.dbNow());
    expect(decision).toMatchObject({ kind: "TAKEOVER", resumeCursor: "after-3", nextFailures: 0 });
    if (decision.kind !== "TAKEOVER") return;
    const owner2 = randomUUID();
    const taken = await s.takeover(decision.expected, {
      attempt: 2,
      failures: 0,
      leaseOwner: owner2,
      trigger: "TIMER",
      leaseSeconds: 300,
      deadlineSeconds: 240,
    });
    expect(taken).toMatchObject({ attempt: 2, cursor: "after-3" });
    expect(await stored(row.id)).toMatchObject({ errorCode: null, finishedAt: null });

    await s.finish(tokenOf(taken!, owner2), { status: "SUCCEEDED", rowsWritten: 5, summary: { chunks: 5 } });
    expect(await stored(row.id)).toMatchObject({ status: "SUCCEEDED", cursor: null, errorCode: null, rowsWritten: 5 });
  });

  it("records a failure's code, scrubbed message and count, keeping the committed cursor", async () => {
    const s = store();
    const request = claimRequest();
    const { row } = await s.claim(request);
    const token = tokenOf(row, request.leaseOwner);
    await s.commit(token, 300, async () => undefined, "after-1");
    await s.finish(token, { status: "FAILED", errorCode: "UNHANDLED", errorMessage: "boom", rowsWritten: 0, summary: {}, failures: 1 });
    expect(await stored(row.id)).toMatchObject({ status: "FAILED", errorCode: "UNHANDLED", errorMessage: "boom", failures: 1, cursor: "after-1" });
  });
});

describe("heavy jobs", () => {
  it("sees another heavy job's live lease, across orgs, but not its own name", async () => {
    const s = store();
    const request = claimRequest({ job: "heavy_a", periodKey: `2026-09-17T${randomUUID().slice(0, 4)}` });
    await s.claim({ ...request, orgId: otherOrg.orgId });
    expect(await s.heavyRunLive("heavy_b")).toBe(true);
    expect(await s.heavyRunLive("heavy_a")).toBe(false);
    expect(await createJobRunStore({ codeVersion: "x", heavyJobs: [] }).heavyRunLive("heavy_b")).toBe(false);
    await db().delete(iqJobRuns).where(and(eq(iqJobRuns.job, "heavy_a"), eq(iqJobRuns.orgId, otherOrg.orgId)));
  });
});

describe("one heartbeat request end to end", () => {
  it("runs the real registry and store for two orgs; a repeat is a no-op", async () => {
    const secret = "s".repeat(40);
    const real = store();
    const s = Object.assign(Object.create(Object.getPrototypeOf(real)), real, {
      listOrgIds: async () => [org.orgId, otherOrg.orgId],
    }) as typeof real;
    const deps = {
      secrets: { current: secret, previous: undefined },
      store: s,
      newLeaseOwner: () => randomUUID(),
      monotonicMs: () => performance.now(),
      every: (ms: number, tick: () => void) => {
        const handle = setInterval(tick, ms);
        return () => clearInterval(handle);
      },
    };
    const headers = { "x-forwarded-for": "127.0.0.1", host: JOB_HOST, authorization: `Bearer ${secret}` } as Record<string, string>;
    const request = { jobParam: "heartbeat", body: undefined, headers: { get: (n: string) => headers[n.toLowerCase()] ?? null } };

    const first = await handleJobRequest(request, deps);
    expect(first).toMatchObject({ status: 200, body: { counts: { SUCCEEDED: 2 } } });
    const periodKey = first.body!.periods[0]!;
    for (const orgId of [org.orgId, otherOrg.orgId]) {
      const [row] = await db()
        .select()
        .from(iqJobRuns)
        .where(and(eq(iqJobRuns.job, "heartbeat"), eq(iqJobRuns.orgId, orgId), eq(iqJobRuns.periodKey, periodKey)));
      expect(row).toMatchObject({ status: "SUCCEEDED", attempt: 1, failures: 0, summary: { fencedCommits: 1 } });
    }
    expect(await handleJobRequest(request, deps)).toMatchObject({ status: 200, body: { counts: { NOOP: 2 } } });
  });
});

describe("the job route (S8) on the local stack", () => {
  const SECRET = "r".repeat(40);
  // Its own org: the end-to-end test above already ran this hour's heartbeat for the file's orgs.
  let routeOrg: TestOrg;
  beforeAll(async () => {
    routeOrg = await createTestOrg();
  });
  afterAll(async () => {
    await deleteTestOrg(routeOrg.orgId);
  });
  const routeRequest = (headers: Record<string, string>) =>
    new Request("http://127.0.0.1:3000/api/jobs/heartbeat", { method: "POST", headers });
  const localHeaders = (secret = SECRET) => ({ "x-forwarded-for": "127.0.0.1", host: JOB_HOST, authorization: `Bearer ${secret}` });
  const params = (job: string) => ({ params: Promise.resolve({ job }) });

  const withSecret = async <T>(secret: string | undefined, run: () => Promise<T>): Promise<T> => {
    const saved = { current: process.env.JOB_SECRET, previous: process.env.JOB_SECRET_PREVIOUS };
    if (secret === undefined) delete process.env.JOB_SECRET;
    else process.env.JOB_SECRET = secret;
    delete process.env.JOB_SECRET_PREVIOUS;
    try {
      return await run();
    } finally {
      if (saved.current === undefined) delete process.env.JOB_SECRET;
      else process.env.JOB_SECRET = saved.current;
      if (saved.previous !== undefined) process.env.JOB_SECRET_PREVIOUS = saved.previous;
    }
  };

  const heartbeatRows = () => db().select({ id: iqJobRuns.id }).from(iqJobRuns).where(eq(iqJobRuns.job, "heartbeat"));

  it("POST answers an empty 404 when JOB_SECRET is unset, the bearer is wrong or missing, the Host is foreign, or the job is unknown — and writes nothing", async () => {
    const before = (await heartbeatRows()).length;
    const cases: [string | undefined, Record<string, string>, string][] = [
      [undefined, localHeaders(), "heartbeat"],
      [SECRET, localHeaders("w".repeat(40)), "heartbeat"],
      [SECRET, { "x-forwarded-for": "127.0.0.1", host: JOB_HOST }, "heartbeat"],
      [SECRET, { ...localHeaders(), host: "frybirdiq.tech" }, "heartbeat"],
      [SECRET, localHeaders(), "no_such_job"],
    ];
    for (const [secret, headers, job] of cases) {
      const response = await withSecret(secret, () => POST(routeRequest(headers), params(job)));
      expect([job, response.status, await response.text()]).toEqual([job, 404, ""]);
    }
    expect((await heartbeatRows()).length).toBe(before);
  });

  it("a heartbeat run through the route's own dependencies writes one SUCCEEDED row per org; a re-run is a no-op", async () => {
    await withSecret(SECRET, async () => {
      const deps = jobRouteDeps();
      // Only this file's org, so the shared local database gains no rows for anyone else's orgs.
      deps.store.listOrgIds = async () => [routeOrg.orgId];
      const { respondToJobRequest } = await import("@/lib/jobs/http");

      const first = await respondToJobRequest(routeRequest(localHeaders()), "heartbeat", () => deps);
      expect(first.status).toBe(200);
      const report = (await first.json()) as { periods: string[]; counts: Record<string, number> };
      expect(report.counts.SUCCEEDED).toBe(1);

      const rows = await db()
        .select()
        .from(iqJobRuns)
        .where(and(eq(iqJobRuns.job, "heartbeat"), eq(iqJobRuns.orgId, routeOrg.orgId), eq(iqJobRuns.periodKey, report.periods[0]!)));
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ status: "SUCCEEDED", attempt: 1, failures: 0, codeVersion: "unversioned", trigger: "TIMER" });

      const again = await respondToJobRequest(routeRequest(localHeaders()), "heartbeat", () => deps);
      expect(again.status).toBe(200);
      expect(((await again.json()) as { counts: Record<string, number> }).counts.NOOP).toBe(1);
    });
  });
});

describe("a job reaches the database only through org-bound ctx (SECURITY condition, iq0-s7c)", () => {
  it("a job running for org A cannot read or write org B's rows through ctx, and never sees a transaction", async () => {
    const s = store();
    // Seed one FACT for each org, written through each org's own run and writers.
    const seed = async (target: TestOrg) => {
      const request = claimRequest({ orgId: target.orgId });
      const { row } = await s.claim(request);
      const token = tokenOf(row, request.leaseOwner);
      const insight = await factFor(target, token, `seed-${target.orgId}-${randomUUID()}`);
      await s.commit(token, 300, (repos) => repos.writeInsight(insight, { asOf: insight.period.end }));
      return insight.id;
    };
    const aInsightId = await seed(org);
    const bInsightId = await seed(otherOrg);
    const bRowsBefore = (await db().select({ id: iqInsights.id }).from(iqInsights).where(eq(iqInsights.orgId, otherOrg.orgId))).length;

    const seen: Record<string, unknown> = {};
    const jobName = `iso_${randomUUID().slice(0, 8)}`;
    const probe = async (ctx: JobContext): Promise<JobRunResult> => {
      const token = { runId: ctx.runId, attempt: ctx.attempt, leaseOwner: "" };
      seen.ctxKeys = Object.keys(ctx).sort();
      seen.readKeys = Object.keys(ctx.repos).sort();

      const listed = await ctx.repos.listInsights({ claimTypes: ["FACT"], limit: 500 });
      seen.listedOrgs = [...new Set(listed.insights.map((i) => i.orgId))];
      seen.listedHasB = listed.insights.some((i) => i.id === bInsightId);
      seen.listedHasA = listed.insights.some((i) => i.id === aInsightId);
      seen.getB = await ctx.repos.getInsight(bInsightId);
      seen.getA = (await ctx.repos.getInsight(aInsightId))?.orgId;
      const figures = await ctx.repos.readFactFigures("revenue.net", { limit: 400 });
      seen.figuresHasB = figures.figures.some((f) => f.insightId === bInsightId);

      await ctx.commit(async (repos) => {
        seen.writeKeys = Object.keys(repos).sort();
      });
      try {
        const cross = await factFor(otherOrg, token, `cross-${randomUUID()}`);
        await ctx.commit(async (repos) => repos.writeInsight(cross, { asOf: cross.period.end }));
        seen.crossWrite = "written";
      } catch (error) {
        seen.crossWrite = (error as Error).message;
      }
      const ownInsight = await factFor(org, token, `own-${randomUUID()}`);
      const own = await ctx.commit(async (repos) => repos.writeInsight(ownInsight, { asOf: ownInsight.period.end }));
      seen.ownWrite = own.outcome;
      return { status: "COMPLETE", rowsWritten: 1, summary: {} };
    };
    const registry: Record<string, JobDefinition> = {
      [jobName]: {
        name: jobName,
        periodKind: "hour",
        target: "current",
        onCalendarUtc: "*-*-* *:00:00 UTC",
        ...DEFAULT_TIMING,
        catchUpPeriods: 0,
        concurrency: "light",
        run: probe,
      },
    };
    const secret = "i".repeat(40);
    const runStore = store();
    runStore.listOrgIds = async () => [org.orgId];
    const headers: Record<string, string> = { "x-forwarded-for": "127.0.0.1", host: JOB_HOST, authorization: `Bearer ${secret}` };
    const response = await handleJobRequest(
      { jobParam: jobName, body: undefined, headers: { get: (n: string) => headers[n.toLowerCase()] ?? null } },
      {
        secrets: { current: secret, previous: undefined },
        store: runStore,
        newLeaseOwner: () => randomUUID(),
        monotonicMs: () => performance.now(),
        every: (ms, tick) => {
          const timer = setInterval(tick, ms);
          return () => clearInterval(timer);
        },
        registry,
      },
    );

    expect(response).toMatchObject({ status: 200, body: { counts: { SUCCEEDED: 1 } } });
    expect(seen).toMatchObject({
      ctxKeys: ["attempt", "codeVersion", "commit", "orgId", "period", "periodKey", "remainingMs", "repos", "resumeCursor", "runId", "shouldStop", "trigger"],
      readKeys: [
        "checkFactsParity",
        "countPaidOrders",
        "countStuckRefundFollowUps",
        "factsHistoryStart",
        "factsReadyFor",
        "getInsight",
        "healLostRefundFollowUps",
        "intradayFreshAt",
        "listInsights",
        "listOpenRecommendations",
        "readBriefFigures",
        "readDetectDays",
        "readFactFigures",
        "readFoodCostTarget",
        "readOpeningHours",
        "readPulseDays",
        "readRecon",
      ],
      writeKeys: [
        "computeTrustDay",
        "expireInsights",
        "proposeRecommendation",
        "purgeIntradayFacts",
        "rebuildIntradayDay",
        "recomputeDay",
        "writeInsight",
      ],
      listedOrgs: [org.orgId],
      listedHasA: true,
      listedHasB: false,
      getB: null,
      getA: org.orgId,
      figuresHasB: false,
      crossWrite: "iq-insights: insight belongs to another org",
      ownWrite: "INSERTED",
    });
    const bRowsAfter = (await db().select({ id: iqInsights.id }).from(iqInsights).where(eq(iqInsights.orgId, otherOrg.orgId))).length;
    expect(bRowsAfter).toBe(bRowsBefore);
  });
});

describe("IQ-1 facts jobs through the runner (iq1-s8) on the local stack", () => {
  const SECRET = "f".repeat(40);
  const orgs: TestOrg[] = [];
  const freshOrg = async () => {
    const created = await createTestOrg();
    orgs.push(created);
    return created;
  };
  afterAll(async () => {
    for (const created of orgs) await deleteTestOrg(created.orgId);
  });

  let yesterday: string;
  beforeAll(async () => {
    yesterday = shiftPeriod("day", periodKeyAt("day", await store().dbNow()), -1);
  });

  /** One job request through handleJobRequest with the real registry and store, for exactly these orgs. */
  async function runJob(job: string, orgIds: string[], options: { period?: string; clock?: () => number } = {}) {
    const runStore = store();
    runStore.listOrgIds = async () => orgIds;
    const headers: Record<string, string> = { "x-forwarded-for": "127.0.0.1", host: JOB_HOST, authorization: `Bearer ${SECRET}` };
    return handleJobRequest(
      { jobParam: job, body: options.period === undefined ? undefined : { period: options.period }, headers: { get: (n) => headers[n.toLowerCase()] ?? null } },
      {
        secrets: { current: SECRET, previous: undefined },
        store: runStore,
        newLeaseOwner: () => randomUUID(),
        monotonicMs: options.clock ?? (() => performance.now()),
        every: () => () => {},
      },
    );
  }

  const factRows = async (orgId: string) => (await db().select({ id: iqDailyFacts.id }).from(iqDailyFacts).where(eq(iqDailyFacts.orgId, orgId))).length;
  const runRow = async (job: string, orgId: string, periodKey: string) =>
    (await db().select().from(iqJobRuns).where(and(eq(iqJobRuns.job, job), eq(iqJobRuns.orgId, orgId), eq(iqJobRuns.periodKey, periodKey))))[0];

  it("nightly recomputes both months for one org only, records the P&L check, and a re-run is a no-op", async () => {
    const a = await freshOrg();
    const b = await freshOrg();
    const planned = nightlyDates(yesterday);
    await seedExpense(a, { amountPaise: 12_345n, paidOn: yesterday });
    await seedExpense(a, { amountPaise: 700n, paidOn: planned[0]! });
    await seedExpense(b, { amountPaise: 999n, paidOn: yesterday });

    const first = await runJob("iq-facts-nightly", [a.orgId], { period: yesterday });
    expect(first).toMatchObject({ status: 200, body: { counts: { SUCCEEDED: 1 } } });
    const row = await runRow("iq-facts-nightly", a.orgId, yesterday);
    expect(row).toMatchObject({ status: "SUCCEEDED", failures: 0, cursor: null });
    expect(row!.summary).toMatchObject({
      days_planned: planned.length,
      days_recomputed: planned.length,
      parity_ok: 1,
      parity_checks: 2,
      parity_mismatches: 0,
      parity_missing_days: 0,
    });
    // Trust is scored for every day, after its facts, recorded against the same run.
    const trustRows = await db()
      .selectDistinct({ date: iqDailyTrust.businessDate, jobRunId: iqDailyTrust.jobRunId })
      .from(iqDailyTrust)
      .where(eq(iqDailyTrust.orgId, a.orgId));
    expect(trustRows.map((t) => t.date).sort()).toEqual(planned);
    expect(new Set(trustRows.map((t) => t.jobRunId))).toEqual(new Set([row!.id]));
    expect(row!.summary.trust_signals_written).toBeGreaterThan(0);

    const facts = await readDailyFacts(a.orgId, planned[0]!, yesterday);
    expect(facts.missingDates).toEqual([]);
    expect(facts.totals.expense_direct).toBe(13_045n);
    const [stamped] = await db().select({ jobRunId: iqDailyFacts.jobRunId }).from(iqDailyFacts).where(eq(iqDailyFacts.orgId, a.orgId)).limit(1);
    expect(stamped?.jobRunId).toBe(row!.id);

    // Org B was not touched by org A's run.
    expect(await factRows(b.orgId)).toBe(0);
    expect((await db().select({ id: iqDailyTrust.id }).from(iqDailyTrust).where(eq(iqDailyTrust.orgId, b.orgId))).length).toBe(0);

    const rowsBefore = await factRows(a.orgId);
    expect(await runJob("iq-facts-nightly", [a.orgId], { period: yesterday })).toMatchObject({ status: 200, body: { counts: { NOOP: 1 } } });
    expect(await factRows(a.orgId)).toBe(rowsBefore);

    // B's own run sees only B's expense; A's figures are unchanged.
    expect(await runJob("iq-facts-nightly", [b.orgId], { period: yesterday })).toMatchObject({ status: 200 });
    expect((await readDailyFacts(b.orgId, yesterday, yesterday)).totals.expense_direct).toBe(999n);
    expect((await readDailyFacts(a.orgId, planned[0]!, yesterday)).totals.expense_direct).toBe(13_045n);
  }, 120_000);

  it("nightly stops cleanly at the deadline with its cursor saved, and the retry resumes and finishes", async () => {
    const c = await freshOrg();
    const planned = nightlyDates(yesterday);
    // A clock that moves 5s every time the runner looks: the 240s deadline arrives part-way through.
    const steppingClock = () => {
      let t = 0;
      return () => (t += 5_000);
    };

    const cut = await runJob("iq-facts-nightly", [c.orgId], { period: yesterday, clock: steppingClock() });
    expect(cut).toMatchObject({ status: 500, body: { counts: { PARTIAL: 1 } } });
    const partial = await runRow("iq-facts-nightly", c.orgId, yesterday);
    expect(partial).toMatchObject({ status: "FAILED", errorCode: "DEADLINE", failures: 0 });
    expect(partial!.cursor).not.toBeNull();
    const done = planned.length - remainingAfter(planned, partial!.cursor).length;
    expect(done).toBeGreaterThan(0);
    expect(done).toBeLessThan(planned.length);
    expect((await readDailyFacts(c.orgId, planned[0]!, yesterday)).computedDates).toHaveLength(done);

    const resumed = await runJob("iq-facts-nightly", [c.orgId], { period: yesterday });
    expect(resumed).toMatchObject({ status: 200, body: { counts: { SUCCEEDED: 1 } } });
    const finished = await runRow("iq-facts-nightly", c.orgId, yesterday);
    expect(finished).toMatchObject({ status: "SUCCEEDED", attempt: 2, failures: 0, cursor: null });
    expect(finished!.summary).toMatchObject({ days_recomputed: planned.length - done, parity_mismatches: 0, parity_missing_days: 0 });
    expect((await readDailyFacts(c.orgId, planned[0]!, yesterday)).missingDates).toEqual([]);
  }, 120_000);

  it("a day locked by another recompute stops the run with DAY_LOCK_BUSY inside the budget, no failure counted, and the retry finishes", async () => {
    const e = await freshOrg();
    const planned = nightlyDates(yesterday);

    // Another recompute holds the first planned day's lock until released.
    let release!: () => void;
    const released = new Promise<void>((resolve) => (release = resolve));
    let locked!: () => void;
    const holding = new Promise<void>((resolve) => (locked = resolve));
    const holder = db().transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${factDayLockKey(e.orgId, planned[0]!)}, 0))`);
      locked();
      await released;
    });
    await holding;

    // 50 s left of the deadline: per locked step, 3 lock waits of 1.666 s and a 5 s statement timeout.
    let calls = 0;
    const lateClock = () => (calls++ === 0 ? 0 : 190_000);
    const started = performance.now();
    try {
      const busy = await runJob("iq-facts-nightly", [e.orgId], { period: yesterday, clock: lateClock });
      expect(busy).toMatchObject({ status: 500, body: { counts: { PARTIAL: 1 } } });
    } finally {
      release();
      await holder;
    }
    expect(performance.now() - started).toBeLessThan(15_000);
    const stopped = await runRow("iq-facts-nightly", e.orgId, yesterday);
    expect(stopped).toMatchObject({ status: "FAILED", errorCode: "DAY_LOCK_BUSY", failures: 0, cursor: null });
    expect(await factRows(e.orgId)).toBe(0);

    expect(await runJob("iq-facts-nightly", [e.orgId], { period: yesterday })).toMatchObject({ status: 200, body: { counts: { SUCCEEDED: 1 } } });
    expect(await runRow("iq-facts-nightly", e.orgId, yesterday)).toMatchObject({ status: "SUCCEEDED", attempt: 2, failures: 0 });
    expect((await readDailyFacts(e.orgId, planned[0]!, yesterday)).missingDates).toEqual([]);
  }, 120_000);

  it("backfill recomputes from the org's opened_on day through the period, and intraday recomputes only today", async () => {
    const d = await freshOrg();
    const openedOn = shiftPeriod("day", yesterday, -2);
    await db().update(organizations).set({ openedOn }).where(eq(organizations.id, d.orgId));

    expect(await runJob("iq-facts-backfill", [d.orgId], { period: yesterday })).toMatchObject({ status: 200, body: { counts: { SUCCEEDED: 1 } } });
    expect((await runRow("iq-facts-backfill", d.orgId, yesterday))!.summary).toMatchObject({ days_planned: 3, days_recomputed: 3 });
    const history = await readDailyFacts(d.orgId, shiftPeriod("day", openedOn, -1), yesterday);
    expect(history.computedDates).toEqual([openedOn, shiftPeriod("day", yesterday, -1), yesterday]);

    const today = shiftPeriod("day", yesterday, 1);
    const intraday = await runJob("iq-facts-intraday", [d.orgId]);
    expect(intraday).toMatchObject({ status: 200, body: { counts: { SUCCEEDED: 1 } } });
    expect(intraday.body!.periods[0]!.slice(0, 10)).toBe(today);
    expect((await readDailyFacts(d.orgId, today, today)).computedDates).toEqual([today]);
  }, 120_000);
});

describe("IQ-2 jobs through the runner (iq2-s7) on the local stack", () => {
  const SECRET = "d".repeat(40);
  const orgs: TestOrg[] = [];
  const freshOrg = async () => {
    const created = await createTestOrg();
    orgs.push(created);
    return created;
  };
  afterAll(async () => {
    for (const created of orgs) await deleteTestOrg(created.orgId);
  });

  let yesterday: string;
  let today: string;
  beforeAll(async () => {
    today = periodKeyAt("day", await store().dbNow());
    yesterday = shiftPeriod("day", today, -1);
  });

  async function run(
    job: string,
    orgIds: string[],
    options: { period?: string; clock?: () => number; registry?: Record<string, JobDefinition> } = {},
  ) {
    // Insights record producedBy.codeVersion, which must be a git sha.
    const runStore = createJobRunStore({ codeVersion: "abc1234", heavyJobs: [] });
    runStore.listOrgIds = async () => orgIds;
    const headers: Record<string, string> = { "x-forwarded-for": "127.0.0.1", host: JOB_HOST, authorization: `Bearer ${SECRET}` };
    return handleJobRequest(
      { jobParam: job, body: options.period === undefined ? undefined : { period: options.period }, headers: { get: (n) => headers[n.toLowerCase()] ?? null } },
      {
        secrets: { current: SECRET, previous: undefined },
        store: runStore,
        newLeaseOwner: () => randomUUID(),
        monotonicMs: options.clock ?? (() => performance.now()),
        every: () => () => {},
        registry: options.registry,
      },
    );
  }

  const runRow = async (job: string, orgId: string, periodKey: string) =>
    (await db().select().from(iqJobRuns).where(and(eq(iqJobRuns.job, job), eq(iqJobRuns.orgId, orgId), eq(iqJobRuns.periodKey, periodKey))))[0];

  /** A SUCCEEDED nightly facts run row, as the U1 gate reads it. */
  const factsRunRow = (target: TestOrg, periodKey: string, finishedAt: Date) =>
    db()
      .insert(iqJobRuns)
      .values({
        orgId: target.orgId,
        job: "iq-facts-nightly",
        periodKey,
        status: "SUCCEEDED",
        trigger: "TIMER",
        attempt: 1,
        leaseOwner: randomUUID(),
        leaseExpiresAt: finishedAt,
        deadlineAt: finishedAt,
        finishedAt,
        codeVersion: "test",
      });

  it("detect fails closed with UPSTREAM_NOT_READY until facts are final, then succeeds and a re-run is a no-op", async () => {
    const g = await freshOrg();
    const other = await freshOrg();

    expect(await run("iq-detect-daily", [g.orgId], { period: yesterday })).toMatchObject({ status: 500, body: { counts: { PARTIAL: 1 } } });
    expect(await runRow("iq-detect-daily", g.orgId, yesterday)).toMatchObject({ status: "FAILED", errorCode: "UPSTREAM_NOT_READY", failures: 0 });

    expect(await run("iq-facts-nightly", [g.orgId], { period: yesterday })).toMatchObject({ status: 200 });
    const detected = await run("iq-detect-daily", [g.orgId], { period: yesterday });
    expect(detected).toMatchObject({ status: 200, body: { counts: { SUCCEEDED: 1 } } });
    expect(await runRow("iq-detect-daily", g.orgId, yesterday)).toMatchObject({ status: "SUCCEEDED", attempt: 2, errorCode: null });
    expect(await run("iq-detect-daily", [g.orgId], { period: yesterday })).toMatchObject({ status: 200, body: { counts: { NOOP: 1 } } });

    // The reader behind it: this org's day has facts and trust; another org's does not.
    const [mine] = await iqRepos(g.orgId).readDetectDays([yesterday]);
    expect(mine).toMatchObject({ date: yesterday, hasFacts: true, parityFlagged: false });
    expect(mine!.figures.revenue_net).toEqual({ unit: "paise", value: "0" });
    expect(mine!.figures.aov_net).toBeUndefined(); // no orders: undefined, not zero
    expect(Object.keys(mine!.trust).length).toBeGreaterThan(0);
    const [theirs] = await iqRepos(other.orgId).readDetectDays([yesterday]);
    expect(theirs).toMatchObject({ hasFacts: false, figures: {}, trust: {} });
  }, 120_000);

  it("the facts gate passes on any later SUCCEEDED nightly run that planned the day and finished after it closed (U1)", async () => {
    const d2 = shiftPeriod("day", yesterday, -1);
    const covered = await freshOrg();
    await factsRunRow(covered, yesterday, new Date());
    expect(await iqRepos(covered.orgId).factsReadyFor(d2)).toBe(true);
    expect(await run("iq-detect-daily", [covered.orgId], { period: d2 })).toMatchObject({ status: 200, body: { counts: { SUCCEEDED: 1 } } });

    const early = await freshOrg();
    await factsRunRow(early, d2, new Date(startOfBusinessDay(d2).getTime() + 3_600_000));
    expect(await iqRepos(early.orgId).factsReadyFor(d2)).toBe(false);
    expect(await run("iq-detect-daily", [early.orgId], { period: d2 })).toMatchObject({ status: 500 });
    expect(await runRow("iq-detect-daily", early.orgId, d2)).toMatchObject({ errorCode: "UPSTREAM_NOT_READY" });
  });

  it("three not-ready attempts, then facts succeed, then the next night's scheduled catch-up evaluates D-1 (RELIABILITY iq2-s7 blocker)", async () => {
    const n = await freshOrg();
    const dMinus1 = shiftPeriod("day", yesterday, -1);

    // Night of D-1: facts are late, so systemd's run and its retries all find them not ready.
    for (let attempt = 0; attempt < 3; attempt++) {
      expect(await run("iq-detect-daily", [n.orgId], { period: dMinus1 })).toMatchObject({ status: 500, body: { counts: { PARTIAL: 1 } } });
    }
    expect(await runRow("iq-detect-daily", n.orgId, dMinus1)).toMatchObject({ status: "FAILED", errorCode: "UPSTREAM_NOT_READY", attempt: 3, failures: 0 });

    // Facts then succeed: the next night's facts run covers D-1 as well.
    await factsRunRow(n, yesterday, new Date());

    // Next night's timer run: catch-up unit D-1 first, then yesterday.
    const scheduled = await run("iq-detect-daily", [n.orgId]);
    expect(scheduled.body!.periods).toEqual([dMinus1, yesterday]);
    expect(scheduled).toMatchObject({ status: 200, body: { counts: { SUCCEEDED: 2, EXHAUSTED: 0 } } });
    expect(await runRow("iq-detect-daily", n.orgId, dMinus1)).toMatchObject({ status: "SUCCEEDED", attempt: 4, failures: 0, errorCode: null });
  });

  /** A fired detection from the detect fixtures, re-keyed, produced by this run. */
  async function probeInsight(ctx: JobContext, dedupeKey: string) {
    const fired = evaluateDetectDay({ date: "2026-09-11", days: history({ values: { revenue_net: 100000n } }), excludedDates: [], foodCostTarget: null })
      .outcomes.find((o): o is Extract<RuleOutcome, { status: "FIRED" }> => o.status === "FIRED");
    if (!fired) throw new Error("fixture no longer fires");
    const insight = await detectionInsight(fired, {
      orgId: ctx.orgId,
      runId: ctx.runId,
      attempt: ctx.attempt,
      codeVersion: ctx.codeVersion,
      newId: randomUUID,
      date: "2026-09-11",
      createdAt: istTimestamp(new Date()),
    });
    return { ...insight, dedupeKey };
  }
  const asOfFor = (periodKey: string) => istDayStart(addDays(periodKey, 1));
  const probeJob = (name: string, run: JobDefinition["run"]): Record<string, JobDefinition> => ({
    [name]: { ...JOB_REGISTRY["iq-detect-daily"], name, catchUpPeriods: 0, deadlineSeconds: 240, run },
  });
  const insightRow = async (orgId: string, dedupeKey: string) =>
    (await db().select().from(iqInsights).where(and(eq(iqInsights.orgId, orgId), eq(iqInsights.dedupeKey, dedupeKey))).orderBy(iqInsights.createdAt)).at(-1);

  it("an older overlapping run gets STALE_WRITE on write and expire; the newer finding stays (C5)", async () => {
    const s = await freshOrg();
    const key = `probe:stale:${randomUUID()}`;
    const writer = probeJob("probe_write", async (ctx) => {
      const insight = await probeInsight(ctx, key);
      const { outcome } = await ctx.commit((repos) => repos.writeInsight(insight, { asOf: asOfFor(ctx.periodKey) }));
      return { status: "COMPLETE", rowsWritten: 1, summary: { [`write_${outcome.toLowerCase()}`]: 1 } };
    });
    const expirer = probeJob("probe_expire", async (ctx) => {
      const result = await ctx.commit((repos) => repos.expireInsights([{ dedupeKey: key, asOf: asOfFor(ctx.periodKey), reason: "CLEARED" }]));
      return { status: "COMPLETE", rowsWritten: result.expired, summary: { expired: result.expired, stale_writes: result.staleWrites } };
    });

    await run("probe_write", [s.orgId], { period: yesterday, registry: writer });
    expect((await runRow("probe_write", s.orgId, yesterday))!.summary).toEqual({ write_inserted: 1 });
    await run("probe_write", [s.orgId], { period: shiftPeriod("day", yesterday, -2), registry: writer });
    expect((await runRow("probe_write", s.orgId, shiftPeriod("day", yesterday, -2)))!.summary).toEqual({ write_stale_write: 1 });
    await run("probe_expire", [s.orgId], { period: shiftPeriod("day", yesterday, -3), registry: expirer });
    expect((await runRow("probe_expire", s.orgId, shiftPeriod("day", yesterday, -3)))!.summary).toEqual({ expired: 0, stale_writes: 1 });
    expect(await insightRow(s.orgId, key)).toMatchObject({ status: "ACTIVE" });

    await run("probe_expire", [s.orgId], { period: yesterday, registry: expirer });
    expect(await insightRow(s.orgId, key)).toMatchObject({ status: "EXPIRED" });
  });

  it("a PARTIAL run never expires past its cursor; the retry finishes the rest (C6)", async () => {
    const p = await freshOrg();
    const keys = [0, 1, 2].map((i) => `probe:partial:${i}:${randomUUID()}`);
    const seed = probeJob("probe_seed", async (ctx) => {
      await ctx.commit(async (repos) => {
        for (const key of keys) await repos.writeInsight(await probeInsight(ctx, key), { asOf: asOfFor(shiftPeriod("day", ctx.periodKey, -1)) });
      });
      return { status: "COMPLETE", rowsWritten: keys.length, summary: {} };
    });
    const expireEach = probeJob("probe_expire_each", async (ctx) => {
      let expired = 0;
      for (const [index, key] of keys.entries()) {
        if (ctx.resumeCursor !== null && index <= Number(ctx.resumeCursor)) continue;
        if (ctx.shouldStop()) return { status: "PARTIAL", reason: "DEADLINE", rowsWritten: expired, summary: { expired } };
        const result = await ctx.commit((repos) => repos.expireInsights([{ dedupeKey: key, asOf: asOfFor(ctx.periodKey), reason: "CLEARED" }]), {
          cursor: String(index),
        });
        expired += result.expired;
      }
      return { status: "COMPLETE", rowsWritten: expired, summary: { expired } };
    });

    await run("probe_seed", [p.orgId], { period: yesterday, registry: seed });
    // Deadline reached right after the first key's chunk.
    let calls = 0;
    const clock = () => (++calls >= 5 ? 250_000 : 0);
    expect(await run("probe_expire_each", [p.orgId], { period: yesterday, registry: expireEach, clock })).toMatchObject({
      status: 500,
      body: { counts: { PARTIAL: 1 } },
    });
    expect(await runRow("probe_expire_each", p.orgId, yesterday)).toMatchObject({ errorCode: "DEADLINE", cursor: "0" });
    expect((await insightRow(p.orgId, keys[0]!))?.status).toBe("EXPIRED");
    expect((await insightRow(p.orgId, keys[1]!))?.status).toBe("ACTIVE");
    expect((await insightRow(p.orgId, keys[2]!))?.status).toBe("ACTIVE");

    expect(await run("probe_expire_each", [p.orgId], { period: yesterday, registry: expireEach })).toMatchObject({ status: 200 });
    for (const key of keys) expect((await insightRow(p.orgId, key))?.status).toBe("EXPIRED");
  });

  it("intraday stops PARTIAL DAY_LOCK_BUSY when today's buckets are locked, keeping today's facts, and the retry rebuilds them", async () => {
    const i = await freshOrg();
    let release!: () => void;
    const released = new Promise<void>((resolve) => (release = resolve));
    let locked!: () => void;
    const holding = new Promise<void>((resolve) => (locked = resolve));
    const holder = db().transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${intradayDayLockKey(i.orgId, today)}, 0))`);
      locked();
      await released;
    });
    await holding;

    // 48 s left: enough for today's facts and trust, then the rebuild waits 3 × 3 s and gives up.
    let calls = 0;
    const lateClock = () => (calls++ === 0 ? 0 : 192_000);
    let busy;
    try {
      busy = await run("iq-facts-intraday", [i.orgId], { clock: lateClock });
    } finally {
      release();
      await holder;
    }
    expect(busy).toMatchObject({ status: 500, body: { counts: { PARTIAL: 1 } } });
    const period = busy!.body!.periods[0]!;
    const partialRow = await runRow("iq-facts-intraday", i.orgId, period);
    expect(partialRow).toMatchObject({ status: "FAILED", errorCode: "DAY_LOCK_BUSY", failures: 0 });
    expect(partialRow!.summary).toMatchObject({ days_recomputed: 1, intraday_lock_busy_days: 1 });
    expect((await readDailyFacts(i.orgId, today, today)).computedDates).toEqual([today]);

    expect(await run("iq-facts-intraday", [i.orgId], { period })).toMatchObject({ status: 200, body: { counts: { SUCCEEDED: 1 } } });
    expect((await runRow("iq-facts-intraday", i.orgId, period))!.summary).toMatchObject({ intraday_days_rebuilt: 1, intraday_lock_busy_days: 0 });
  }, 60_000);
});

describe("refund-followup-heal through the job route (ref-b7) on the local stack", () => {
  const SECRET = "h".repeat(40);
  let healOrg: TestOrg;
  beforeAll(async () => {
    healOrg = await createTestOrg();
  });
  afterAll(async () => {
    await deleteTestOrg(healOrg.orgId);
  });

  /** A PAID cash order, fully refunded through refundPayment, whose follow-up is then made to look lost. */
  async function lostRefundFollowUp() {
    const amount = fromRupees("250");
    const [order] = await db()
      .insert(orders)
      .values({
        orgId: healOrg.orgId,
        locationId: healOrg.locationId,
        orderNumber: `TEST-${randomUUID().slice(0, 8)}`,
        businessDate: new Date().toISOString().slice(0, 10),
        status: "PAID",
        channel: "TAKEAWAY",
        fulfilment: "TAKEAWAY",
        grandTotal: amount,
      })
      .returning({ id: orders.id });
    const [payment] = await db()
      .insert(payments)
      .values({ orgId: healOrg.orgId, orderId: order!.id, status: "CAPTURED", method: "CASH", amount, provider: CASH_PROVIDER, capturedAt: new Date() })
      .returning({ id: payments.id });
    const result = await refundPayment({
      paymentId: payment!.id,
      amount,
      reason: "test",
      actorUserId: randomUUID(),
      actorRoles: ["OWNER"],
      orgId: healOrg.orgId,
      idempotencyKey: randomUUID(),
    });
    expect(result).toMatchObject({ ok: true, fullyRefunded: true });
    // The follow-up writes the money event last: without it, and finalized long enough ago, the follow-up is lost.
    await db().delete(orderEvents).where(and(eq(orderEvents.orderId, order!.id), sql`${orderEvents.metadata}->>'refundId' IS NOT NULL`));
    await db().update(refunds).set({ finalizedAt: new Date(Date.now() - 10 * 60_000) }).where(eq(refunds.paymentId, payment!.id));
    return order!.id;
  }
  const moneyEvents = (orderId: string) =>
    db().select({ id: orderEvents.id }).from(orderEvents).where(and(eq(orderEvents.orderId, orderId), sql`${orderEvents.metadata}->>'refundId' IS NOT NULL`));

  it("heals a lost refund follow-up through the route; a re-run of the quarter is a no-op", async () => {
    const orderId = await lostRefundFollowUp();
    expect(await moneyEvents(orderId)).toHaveLength(0);

    const saved = process.env.JOB_SECRET;
    process.env.JOB_SECRET = SECRET;
    try {
      const deps = jobRouteDeps();
      deps.store.listOrgIds = async () => [healOrg.orgId];
      const { respondToJobRequest } = await import("@/lib/jobs/http");
      const request = () =>
        new Request("http://127.0.0.1:3000/api/jobs/refund-followup-heal", {
          method: "POST",
          headers: { "x-forwarded-for": "127.0.0.1", host: JOB_HOST, authorization: `Bearer ${SECRET}` },
        });

      const response = await respondToJobRequest(request(), "refund-followup-heal", () => deps);
      expect(response.status).toBe(200);
      const report = (await response.json()) as { periods: string[]; counts: Record<string, number> };
      expect(report.counts.SUCCEEDED).toBe(1);
      expect(await moneyEvents(orderId)).toHaveLength(1);

      const [row] = await db()
        .select()
        .from(iqJobRuns)
        .where(and(eq(iqJobRuns.job, "refund-followup-heal"), eq(iqJobRuns.orgId, healOrg.orgId), eq(iqJobRuns.periodKey, report.periods[0]!)));
      expect(row).toMatchObject({ status: "SUCCEEDED", failures: 0 });
      expect(row!.summary).toEqual({ examined: 1, healed: 1, still_open: 0, not_reached: 0, stuck: 0 });

      const again = await respondToJobRequest(request(), "refund-followup-heal", () => deps);
      expect(((await again.json()) as { counts: Record<string, number> }).counts.NOOP).toBe(1);
      expect(await moneyEvents(orderId)).toHaveLength(1);
    } finally {
      if (saved === undefined) delete process.env.JOB_SECRET;
      else process.env.JOB_SECRET = saved;
    }
  }, 60_000);

  it("a follow-up failed on two heals alerts PARTIAL REFUNDS_STILL_OPEN on the run and on its retry; once healed the run SUCCEEDS (RELIABILITY ref-b7j)", async () => {
    // The previous test already ran this quarter for this org; start the quarter fresh.
    await db().delete(iqJobRuns).where(and(eq(iqJobRuns.job, "refund-followup-heal"), eq(iqJobRuns.orgId, healOrg.orgId)));
    const orderId = await lostRefundFollowUp();
    const [refund] = await db()
      .select({ id: refunds.id })
      .from(refunds)
      .innerJoin(payments, eq(payments.id, refunds.paymentId))
      .where(and(eq(payments.orderId, orderId), eq(refunds.orgId, healOrg.orgId)));
    // Two failed heals, the latest inside the healer's one-hour back-off, so this quarter's heal skips it.
    const failedHeal = (attempts: number, minutesAgo: number) =>
      db().insert(auditLogs).values({
        orgId: healOrg.orgId,
        action: "refund_followup_failed",
        entity: "refunds",
        entityId: refund!.id,
        before: { attempts: attempts - 1 },
        after: { attempts, error: "Error", orderId },
        createdAt: new Date(Date.now() - minutesAgo * 60_000),
      });
    await failedHeal(1, 90);
    await failedHeal(2, 20);

    const saved = process.env.JOB_SECRET;
    process.env.JOB_SECRET = SECRET;
    try {
      const deps = jobRouteDeps();
      deps.store.listOrgIds = async () => [healOrg.orgId];
      const { respondToJobRequest } = await import("@/lib/jobs/http");
      const post = () =>
        respondToJobRequest(
          new Request("http://127.0.0.1:3000/api/jobs/refund-followup-heal", {
            method: "POST",
            headers: { "x-forwarded-for": "127.0.0.1", host: JOB_HOST, authorization: `Bearer ${SECRET}` },
          }),
          "refund-followup-heal",
          () => deps,
        );
      const row = async (periodKey: string) =>
        (await db().select().from(iqJobRuns).where(and(eq(iqJobRuns.job, "refund-followup-heal"), eq(iqJobRuns.orgId, healOrg.orgId), eq(iqJobRuns.periodKey, periodKey))))[0]!;

      const first = await post();
      expect(first.status).toBe(500);
      const period = ((await first.json()) as { periods: string[] }).periods[0]!;
      expect(await row(period)).toMatchObject({ status: "FAILED", errorCode: "REFUNDS_STILL_OPEN", failures: 1 });
      expect((await row(period)).summary).toMatchObject({ examined: 0, stuck: 1 });

      // systemd's retry of the same quarter: still stuck, still alerting.
      expect((await post()).status).toBe(500);
      expect(await row(period)).toMatchObject({ status: "FAILED", errorCode: "REFUNDS_STILL_OPEN", attempt: 2, failures: 2 });

      // The back-off ends and the heal finishes the follow-up: the alert clears on its own.
      await db()
        .update(auditLogs)
        .set({ createdAt: new Date(Date.now() - 2 * 60 * 60_000) })
        .where(and(eq(auditLogs.entityId, refund!.id), eq(auditLogs.action, "refund_followup_failed")));
      expect((await post()).status).toBe(200);
      expect(await row(period)).toMatchObject({ status: "SUCCEEDED", attempt: 3 });
      expect((await row(period)).summary).toEqual({ examined: 1, healed: 1, still_open: 0, not_reached: 0, stuck: 0 });
      expect(await moneyEvents(orderId)).toHaveLength(1);
    } finally {
      if (saved === undefined) delete process.env.JOB_SECRET;
      else process.env.JOB_SECRET = saved;
    }
  }, 60_000);
});
