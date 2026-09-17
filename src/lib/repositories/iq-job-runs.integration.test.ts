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
import { auditLogs, iqJobRuns } from "@/db/schema";
import { JOB_HOST } from "@/lib/jobs/auth";
import { decideClaim } from "@/lib/jobs/claim-decision";
import { LeaseLostError, type LeaseToken } from "@/lib/jobs/fence";
import { handleJobRequest, type ClaimRequest } from "@/lib/jobs/handle";
import { createTestOrg, deleteTestOrg, type TestOrg } from "./__test-support__/fixtures";
import { createJobRunStore, type JobTx } from "./iq-job-runs";
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

/** A chunk write: one audit row, so a rollback is visible. */
const auditWrite = (marker: string) => async (tx: JobTx) => {
  await tx.insert(auditLogs).values({ orgId: org.orgId, action: "job_test_chunk", entity: "iq_job_runs", after: { marker } });
};
const auditCount = async (marker: string) =>
  (
    await db()
      .select({ id: auditLogs.id })
      .from(auditLogs)
      .where(and(eq(auditLogs.orgId, org.orgId), sql`${auditLogs.after} ->> 'marker' = ${marker}`))
  ).length;

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
    await s.commit(tokenOf(row, request.leaseOwner), 300, auditWrite(`ok-${row.id}`), "after-1");
    const after = await stored(row.id);
    expect(after.cursor).toBe("after-1");
    expect(after.heartbeatAt).toBeInstanceOf(Date);
    expect(after.leaseExpiresAt.getTime()).toBeGreaterThan(before.leaseExpiresAt.getTime());
    expect(await auditCount(`ok-${row.id}`)).toBe(1);
  });

  it("rolls back a fenced-out chunk: wrong owner, wrong attempt, or a run this store never claimed", async () => {
    const s = store();
    const request = claimRequest();
    const { row } = await s.claim(request);
    const marker = `fenced-${row.id}`;
    expect(await isLeaseLost(s.commit(tokenOf(row, randomUUID()), 300, auditWrite(marker), "x"))).toBe(true);
    expect(await isLeaseLost(s.commit({ ...tokenOf(row, request.leaseOwner), attempt: 2 }, 300, auditWrite(marker)))).toBe(true);
    expect(await isLeaseLost(store().commit(tokenOf(row, request.leaseOwner), 300, auditWrite(marker)))).toBe(true);
    expect(await auditCount(marker)).toBe(0);
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
    const chunk = a.commit(tokenOf(row, request.leaseOwner), 60, async (tx) => {
      chunkStarted();
      await gate;
      await auditWrite(`c1-${row.id}`)(tx);
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
    expect(await auditCount(`c1-${row.id}`)).toBe(1);
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
    expect(await isLeaseLost(a.commit(tokenA, 300, auditWrite(marker)))).toBe(true);
    expect(await isLeaseLost(a.heartbeat(tokenA, 300))).toBe(true);
    expect(await isLeaseLost(a.finish(tokenA, { status: "SUCCEEDED", rowsWritten: 9, summary: {} }))).toBe(true);
    expect(await auditCount(marker)).toBe(0);

    const tokenB = tokenOf(taken!, ownerB);
    await b.commit(tokenB, 300, auditWrite(`${marker}-b`));
    await b.finish(tokenB, { status: "SUCCEEDED", rowsWritten: 1, summary: { chunks: 1 } });
    expect(await stored(row.id)).toMatchObject({ status: "SUCCEEDED", attempt: 2, trigger: "CATCHUP", rowsWritten: 1 });
    expect(await auditCount(`${marker}-b`)).toBe(1);
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
    await s.finish(token, { status: "DEADLINE", rowsWritten: 3, summary: { chunks: 3 }, cursor: "after-3", failures: 0 });
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
