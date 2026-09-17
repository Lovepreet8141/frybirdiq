import { describe, expect, it } from "vitest";

import { MemoryStore, type MemoryTx } from "./__test-support__/memory-store";
import { JOB_HOST } from "./auth";
import type { JobContext, JobRunResult } from "./context";
import {
  COMMIT_GRACE_SECONDS,
  errorCodeOf,
  handleJobRequest,
  scrubErrorMessage,
  type HandleDeps,
  type JobRequest,
} from "./handle";
import { DEFAULT_TIMING, type JobDefinition } from "./registry";

const SECRET = "s".repeat(40);
// 10:15 IST on 2026-09-17 → heartbeat period "2026-09-17T10".
const NOW = new Date("2026-09-17T04:45:00Z");
const HOUR = "2026-09-17T10";

const request = (overrides: Partial<JobRequest> & { header?: Record<string, string | null> } = {}): JobRequest => {
  const merged: Record<string, string | null> = {
    "x-forwarded-for": "127.0.0.1",
    host: JOB_HOST,
    authorization: `Bearer ${SECRET}`,
    ...overrides.header,
  };
  return {
    jobParam: overrides.jobParam ?? "heartbeat",
    body: overrides.body,
    headers: { get: (name) => merged[name.toLowerCase()] ?? null },
  };
};

type Harness = {
  store: MemoryStore;
  deps: HandleDeps<MemoryTx>;
  clock: { ms: number };
  ticks: (() => void)[];
  owners: string[];
};

function harness(registry?: Record<string, JobDefinition>, orgIds?: string[]): Harness {
  const store = new MemoryStore(NOW, orgIds);
  const clock = { ms: 0 };
  const ticks: (() => void)[] = [];
  const owners: string[] = [];
  let n = 0;
  const deps: HandleDeps<MemoryTx> = {
    secrets: { current: SECRET, previous: undefined },
    store,
    newLeaseOwner: () => {
      const owner = `owner-${++n}`;
      owners.push(owner);
      return owner;
    },
    monotonicMs: () => clock.ms,
    every: (_ms, tick) => {
      ticks.push(tick);
      return () => {
        const i = ticks.indexOf(tick);
        if (i >= 0) ticks.splice(i, 1);
      };
    },
    registry,
  };
  return { store, deps, clock, ticks, owners };
}

const job = (run: (ctx: JobContext<MemoryTx>) => Promise<JobRunResult>, overrides: Partial<JobDefinition> = {}) => ({
  test_job: {
    name: "test_job",
    periodKind: "hour",
    target: "current",
    onCalendarUtc: "*-*-* *:00:00 UTC",
    ...DEFAULT_TIMING,
    catchUpPeriods: 0,
    concurrency: "light",
    run: run as JobDefinition["run"],
    ...overrides,
  } satisfies JobDefinition,
});

const complete = (rowsWritten = 0): JobRunResult => ({ status: "COMPLETE", rowsWritten, summary: {} });

describe("refusals are an empty 404", () => {
  it.each([
    ["dormant", { secrets: { current: undefined, previous: undefined } }, request()],
    ["x-real-ip", {}, request({ header: { "x-real-ip": "203.0.113.9" } })],
    ["public xff", {}, request({ header: { "x-forwarded-for": "203.0.113.9" } })],
    ["host", {}, request({ header: { host: "localhost:3000" } })],
    ["wrong secret", {}, request({ header: { authorization: "Bearer nope" } })],
    ["unknown job", {}, request({ jobParam: "nope" })],
    ["unknown body key", {}, request({ body: { period: HOUR, extra: 1 } })],
    ["body not an object", {}, request({ body: "2026-09-17T10" })],
    ["malformed period", {}, request({ body: { period: "2026-09-17" } })],
    ["future period", {}, request({ body: { period: "2026-09-17T11" } })],
    ["period over 14 days back", {}, request({ body: { period: "2026-09-02T10" } })],
  ] as const)("%s", async (_name, depsOverride, req) => {
    const h = harness();
    const response = await handleJobRequest(req, { ...h.deps, ...depsOverride });
    expect(response).toEqual({ status: 404, body: null });
    expect(h.store.runs.size).toBe(0);
  });
});

describe("heartbeat end to end", () => {
  it("claims the IST hour, commits through the fence and succeeds; a repeat is a no-op", async () => {
    const h = harness();
    const first = await handleJobRequest(request(), h.deps);
    expect(first.status).toBe(200);
    expect(first.body?.periods).toEqual([HOUR]);
    expect(first.body?.counts.SUCCEEDED).toBe(1);
    expect(h.store.run("heartbeat", "org-a", HOUR)).toMatchObject({
      status: "SUCCEEDED",
      attempt: 1,
      trigger: "TIMER",
      summary: { fencedCommits: 1 },
    });
    expect(h.ticks).toHaveLength(0); // heartbeat timer stopped

    const second = await handleJobRequest(request(), h.deps);
    expect(second.status).toBe(200);
    expect(second.body?.counts.NOOP).toBe(1);
  });

  it("accepts the previous secret and a manual period", async () => {
    const h = harness();
    const deps = { ...h.deps, secrets: { current: "n".repeat(40), previous: SECRET } };
    const response = await handleJobRequest(request({ body: { period: "2026-09-16T23" } }), deps);
    expect(response.status).toBe(200);
    expect(h.store.run("heartbeat", "org-a", "2026-09-16T23")?.trigger).toBe("MANUAL");
  });

  it("runs once per org", async () => {
    const h = harness(undefined, ["org-a", "org-b"]);
    const response = await handleJobRequest(request(), h.deps);
    expect(response.body?.counts.SUCCEEDED).toBe(2);
    expect(h.store.run("heartbeat", "org-b", HOUR)?.status).toBe("SUCCEEDED");
  });
});

describe("claims against existing rows", () => {
  const seed = (h: Harness, overrides: Partial<Parameters<MemoryStore["seed"]>[0]>) =>
    h.store.seed({
      job: "test_job",
      orgId: "org-a",
      periodKey: HOUR,
      status: "RUNNING",
      attempt: 1,
      leaseOwner: "someone-else",
      leaseExpiresAt: new Date(NOW.getTime() + 60_000),
      cursor: null,
      ...overrides,
    });

  it("leaves a live run alone and answers 200", async () => {
    let ran = false;
    const h = harness(job(async () => ((ran = true), complete())));
    seed(h, {});
    const response = await handleJobRequest(request({ jobParam: "test_job" }), h.deps);
    expect(response).toMatchObject({ status: 200, body: { counts: { BUSY: 1 } } });
    expect(ran).toBe(false);
  });

  it("takes over a FAILED run, resuming its cursor on the next attempt", async () => {
    let seen: { attempt: number; cursor: string | null } | null = null;
    const h = harness(job(async (ctx) => ((seen = { attempt: ctx.attempt, cursor: ctx.resumeCursor }), complete(3))));
    seed(h, { status: "FAILED", attempt: 1, cursor: "chunk-7" });
    const response = await handleJobRequest(request({ jobParam: "test_job" }), h.deps);
    expect(response.status).toBe(200);
    expect(seen).toEqual({ attempt: 2, cursor: "chunk-7" });
    expect(h.store.run("test_job", "org-a", HOUR)).toMatchObject({ status: "SUCCEEDED", attempt: 2, rowsWritten: 3, cursor: null });
  });

  it("answers 500 at max attempts and closes a zombie", async () => {
    const h = harness(job(async () => complete()));
    seed(h, { attempt: 3, failures: 2, leaseExpiresAt: new Date(NOW.getTime() - 1) });
    const response = await handleJobRequest(request({ jobParam: "test_job" }), h.deps);
    expect(response).toMatchObject({ status: 500, body: { counts: { EXHAUSTED: 1 } } });
    expect(h.store.run("test_job", "org-a", HOUR)).toMatchObject({ status: "FAILED", errorCode: "LEASE_EXPIRED" });
  });

  it("reports BUSY when another worker wins the takeover race", async () => {
    const h = harness(job(async () => complete()));
    const row = seed(h, { status: "FAILED" });
    const original = h.store.takeover.bind(h.store);
    h.store.takeover = async (expected, next) => {
      row.leaseOwner = "faster-worker"; // the CAS no longer matches
      return original(expected, next);
    };
    const response = await handleJobRequest(request({ jobParam: "test_job" }), h.deps);
    expect(response).toMatchObject({ status: 200, body: { counts: { BUSY: 1 } } });
  });
});

describe("fencing: a zombie run cannot write", () => {
  it("loses its lease to a takeover, and its late commit writes nothing", async () => {
    let release!: () => void;
    const stalled = new Promise<void>((resolve) => (release = resolve));
    let attempts = 0;
    const h = harness(
      job(async (ctx) => {
        attempts += 1;
        if (ctx.attempt === 1) {
          await stalled; // run A hangs past its lease
          await ctx.commit(async (tx) => tx.write("A"));
          return complete(1);
        }
        await ctx.commit(async (tx) => tx.write("B"));
        return complete(1);
      }),
    );

    const runA = handleJobRequest(request({ jobParam: "test_job" }), h.deps);
    await new Promise((r) => setTimeout(r, 0));
    expect(h.store.run("test_job", "org-a", HOUR)?.status).toBe("RUNNING");

    h.store.advance(DEFAULT_TIMING.leaseSeconds + 1);
    const runB = await handleJobRequest(request({ jobParam: "test_job" }), h.deps);
    expect(runB).toMatchObject({ status: 200, body: { counts: { SUCCEEDED: 1 } } });

    release();
    const a = await runA;
    expect(a).toMatchObject({ status: 500, body: { counts: { LEASE_LOST: 1 } } });
    expect(attempts).toBe(2);
    expect(h.store.committed).toEqual(["B"]);
    expect(h.store.run("test_job", "org-a", HOUR)).toMatchObject({ status: "SUCCEEDED", attempt: 2 });
  });

  it("marks the lease lost when a heartbeat is refused, and tells the job to stop", async () => {
    let stopSeen = false;
    const h = harness(
      job(async (ctx) => {
        h.store.advance(DEFAULT_TIMING.leaseSeconds + 1); // heartbeats never arrived in time
        h.ticks[0]!();
        await new Promise((r) => setTimeout(r, 0));
        stopSeen = ctx.shouldStop();
        return complete();
      }),
    );
    const response = await handleJobRequest(request({ jobParam: "test_job" }), h.deps);
    expect(stopSeen).toBe(true);
    expect(response).toMatchObject({ status: 500, body: { counts: { LEASE_LOST: 1 } } });
    expect(h.store.run("test_job", "org-a", HOUR)?.status).toBe("RUNNING"); // left for the lease to expire
  });

  it("extends the lease on each heartbeat", async () => {
    const h = harness(
      job(async () => {
        h.store.advance(200);
        h.ticks[0]!();
        await new Promise((r) => setTimeout(r, 0));
        h.store.advance(200); // 400s since claim, but only 200s since the heartbeat
        return complete();
      }),
    );
    const response = await handleJobRequest(request({ jobParam: "test_job" }), h.deps);
    expect(response.status).toBe(200);
    expect(h.store.heartbeats).toBe(1);
  });
});

describe("deadline", () => {
  it("records a PARTIAL run as FAILED DEADLINE with its cursor, and the retry resumes", async () => {
    const cursors: (string | null)[] = [];
    const h = harness(
      job(async (ctx) => {
        cursors.push(ctx.resumeCursor);
        if (ctx.resumeCursor === null) {
          await ctx.commit(async (tx) => tx.write("chunk-1"), { cursor: "after-1" });
          h.clock.ms += DEFAULT_TIMING.deadlineSeconds * 1000;
          expect(ctx.shouldStop()).toBe(true);
          return { status: "PARTIAL", rowsWritten: 1, summary: { chunks: 1 } };
        }
        await ctx.commit(async (tx) => tx.write("chunk-2"));
        return complete(1);
      }),
    );
    const first = await handleJobRequest(request({ jobParam: "test_job" }), h.deps);
    expect(first).toMatchObject({ status: 500, body: { counts: { PARTIAL: 1 } } });
    expect(h.store.run("test_job", "org-a", HOUR)).toMatchObject({
      status: "FAILED",
      errorCode: "DEADLINE",
      cursor: "after-1",
      failures: 0,
    });

    h.clock.ms = 0;
    const retry = await handleJobRequest(request({ jobParam: "test_job" }), h.deps);
    expect(retry.status).toBe(200);
    expect(cursors).toEqual([null, "after-1"]);
    expect(h.store.committed).toEqual(["chunk-1", "chunk-2"]);
  });

  it("starts no new unit after the shared deadline and answers 500", async () => {
    const h = harness(
      job(async () => {
        h.clock.ms += DEFAULT_TIMING.deadlineSeconds * 1000;
        return complete();
      }),
      ["org-a", "org-b"],
    );
    const response = await handleJobRequest(request({ jobParam: "test_job" }), h.deps);
    expect(response).toMatchObject({ status: 500, body: { counts: { SUCCEEDED: 1, DEFERRED: 1 } } });
    expect(h.store.run("test_job", "org-b", HOUR)).toBeUndefined();
  });
});

describe("failures", () => {
  it("stores a code and a scrubbed message, never the raw error", async () => {
    const h = harness(
      job(async () => {
        const error = Object.assign(
          new Error("connect postgresql://user:pw@db:5432/x failed for a@b.co 9876543210 Bearer abc.def"),
          { code: "ECONNREFUSED" },
        );
        throw error;
      }),
    );
    const response = await handleJobRequest(request({ jobParam: "test_job" }), h.deps);
    expect(response).toMatchObject({ status: 500, body: { counts: { FAILED: 1 } } });
    const row = h.store.run("test_job", "org-a", HOUR)!;
    expect(row.errorCode).toBe("ECONNREFUSED");
    expect(row.errorMessage).toBe("connect [url] failed for [email] [number] Bearer [redacted]");
    expect(scrubErrorMessage(new Error("call +91 98765 43210 or 098-7654-3210 about 2026-09-17 run 42"))).toBe(
      "call [number] or [number] about 2026-09-17 run 42",
    );
  });

  it("rolls back a chunk whose write throws", async () => {
    const h = harness(
      job(async (ctx) => {
        await ctx.commit(async (tx) => {
          tx.write("half");
          throw new Error("boom");
        });
        return complete();
      }),
    );
    await handleJobRequest(request({ jobParam: "test_job" }), h.deps);
    expect(h.store.committed).toEqual([]);
    expect(h.store.run("test_job", "org-a", HOUR)).toMatchObject({ status: "FAILED", errorCode: "UNHANDLED" });
  });

  it("answers 500 with no body when the store itself fails", async () => {
    const h = harness();
    h.store.listOrgIds = async () => {
      throw new Error("db down");
    };
    expect(await handleJobRequest(request(), h.deps)).toEqual({ status: 500, body: null });
  });

  it("defers a heavy job while another heavy job runs", async () => {
    const h = harness(job(async () => complete(), { concurrency: "heavy" }));
    h.store.heavyLive = true;
    const response = await handleJobRequest(request({ jobParam: "test_job" }), h.deps);
    expect(response).toMatchObject({ status: 500, body: { counts: { HEAVY_BUSY: 1 } } });
    expect(h.store.runs.size).toBe(0);
  });

  it("claims catch-up periods oldest first", async () => {
    const order: string[] = [];
    const h = harness(job(async (ctx) => (order.push(`${ctx.trigger}:${ctx.periodKey}`), complete()), { catchUpPeriods: 2 }));
    await handleJobRequest(request({ jobParam: "test_job" }), h.deps);
    expect(order).toEqual(["CATCHUP:2026-09-17T08", "CATCHUP:2026-09-17T09", `TIMER:${HOUR}`]);
  });
});

describe("error helpers", () => {
  it("accepts only UPPER_SNAKE codes", () => {
    expect(errorCodeOf(Object.assign(new Error(), { code: "DEADLINE" }))).toBe("DEADLINE");
    expect(errorCodeOf(Object.assign(new Error(), { code: "select * from x" }))).toBe("UNHANDLED");
    expect(errorCodeOf("string")).toBe("UNHANDLED");
  });

  it("caps messages at 500 characters and ignores non-errors", () => {
    expect(scrubErrorMessage(new Error("x".repeat(900)))?.length).toBe(500);
    expect(scrubErrorMessage({ message: "not an Error" })).toBeNull();
  });
});

describe("RELIABILITY review of ff7b92b", () => {
  const settle = () => new Promise((r) => setTimeout(r, 0));

  it("M1 stops heartbeating a job hung past the deadline, so its lease lapses and a retry takes over", async () => {
    let release!: () => void;
    const hung = new Promise<void>((resolve) => (release = resolve));
    const h = harness(
      job(async (ctx) => {
        if (ctx.attempt === 1) await hung;
        return complete();
      }),
    );
    const first = handleJobRequest(request({ jobParam: "test_job" }), h.deps);
    await settle();

    h.clock.ms += DEFAULT_TIMING.deadlineSeconds * 1000;
    h.ticks[0]!(); // the 60s timer fires after the deadline
    await settle();
    expect(h.store.heartbeats).toBe(0);
    expect(h.ticks).toHaveLength(0);

    h.store.advance(DEFAULT_TIMING.leaseSeconds + 1);
    const retry = await handleJobRequest(request({ jobParam: "test_job" }), h.deps);
    expect(retry).toMatchObject({ status: 200, body: { counts: { SUCCEEDED: 1 } } });
    expect(h.store.run("test_job", "org-a", HOUR)).toMatchObject({ status: "SUCCEEDED", attempt: 2, failures: 1 });

    release();
    expect(await first).toMatchObject({ status: 500, body: { counts: { LEASE_LOST: 1 } } });
  });

  it("M2 never exhausts a long job that makes progress at every deadline", async () => {
    const CHUNKS = 5;
    const h = harness(
      job(async (ctx) => {
        const n = Number(ctx.resumeCursor ?? "0");
        await ctx.commit(async (tx) => tx.write(`chunk-${n}`), { cursor: String(n + 1) });
        if (n + 1 === CHUNKS) return complete(CHUNKS);
        h.clock.ms += DEFAULT_TIMING.deadlineSeconds * 1000;
        return { status: "PARTIAL", rowsWritten: 1, summary: {} };
      }),
    );
    const statuses: number[] = [];
    for (let i = 0; i < CHUNKS; i++) statuses.push((await handleJobRequest(request({ jobParam: "test_job" }), h.deps)).status);
    expect(statuses).toEqual([500, 500, 500, 500, 200]);
    expect(h.store.committed).toEqual(["chunk-0", "chunk-1", "chunk-2", "chunk-3", "chunk-4"]);
    expect(h.store.run("test_job", "org-a", HOUR)).toMatchObject({ status: "SUCCEEDED", attempt: CHUNKS, failures: 0 });
  });

  it("M2 counts a deadline cut with no progress as a failure", async () => {
    const h = harness(
      job(async (ctx) => {
        await ctx.commit(async () => undefined, { cursor: "stuck" });
        h.clock.ms += DEFAULT_TIMING.deadlineSeconds * 1000;
        return { status: "PARTIAL", rowsWritten: 0, summary: {} };
      }),
    );
    const outcomes: string[] = [];
    for (let i = 0; i < 5; i++) {
      const r = await handleJobRequest(request({ jobParam: "test_job" }), h.deps);
      outcomes.push(Object.entries(r.body!.counts).find(([, n]) => n > 0)![0]);
    }
    // null → "stuck" is progress; then "stuck" → "stuck" three times reaches the limit.
    expect(outcomes).toEqual(["PARTIAL", "PARTIAL", "PARTIAL", "PARTIAL", "EXHAUSTED"]);
    expect(h.store.run("test_job", "org-a", HOUR)?.failures).toBe(3);
  });

  it("M3 saves the cursor with each chunk, so progress survives a crash before finish", async () => {
    const seen: (string | null)[] = [];
    const h = harness(
      job(async (ctx) => {
        seen.push(ctx.resumeCursor);
        if (ctx.resumeCursor === null) {
          await ctx.commit(async (tx) => tx.write("chunk-1"), { cursor: "after-1" });
          throw new Error("crashed after a committed chunk");
        }
        await ctx.commit(async (tx) => tx.write("chunk-2"), { cursor: "after-2" });
        return complete();
      }),
    );
    expect((await handleJobRequest(request({ jobParam: "test_job" }), h.deps)).status).toBe(500);
    expect(h.store.run("test_job", "org-a", HOUR)).toMatchObject({ status: "FAILED", cursor: "after-1", failures: 1 });

    expect((await handleJobRequest(request({ jobParam: "test_job" }), h.deps)).status).toBe(200);
    expect(seen).toEqual([null, "after-1"]);
    expect(h.store.committed).toEqual(["chunk-1", "chunk-2"]);
  });

  it("M3 does not save a cursor whose chunk was rolled back", async () => {
    const h = harness(
      job(async (ctx) => {
        await ctx.commit(
          async () => {
            throw new Error("write failed");
          },
          { cursor: "never" },
        );
        return complete();
      }),
    );
    await handleJobRequest(request({ jobParam: "test_job" }), h.deps);
    expect(h.store.run("test_job", "org-a", HOUR)?.cursor).toBeNull();
  });

  it("M4 isolates a unit whose store call throws; the other orgs still run", async () => {
    const h = harness(job(async () => complete()), ["org-a", "org-b"]);
    const claim = h.store.claim.bind(h.store);
    h.store.claim = async (req) => {
      if (req.orgId === "org-a") throw new Error("claim failed");
      return claim(req);
    };
    const response = await handleJobRequest(request({ jobParam: "test_job" }), h.deps);
    expect(response).toMatchObject({ status: 500, body: { counts: { FAILED: 1, SUCCEEDED: 1 } } });
    expect(h.store.run("test_job", "org-b", HOUR)?.status).toBe("SUCCEEDED");
  });
});

describe("RELIABILITY re-review of d19f296", () => {
  it("J1 records the last committed cursor at a deadline, not one the job only claims", async () => {
    const h = harness(
      job(async (ctx) => {
        await ctx.commit(async (tx) => tx.write("chunk-1"), { cursor: "after-1" });
        h.clock.ms += DEFAULT_TIMING.deadlineSeconds * 1000;
        // A job that reports more progress than it committed must not skip work.
        return { status: "PARTIAL", rowsWritten: 2, summary: {}, cursor: "after-2" } as JobRunResult;
      }),
    );
    await handleJobRequest(request({ jobParam: "test_job" }), h.deps);
    expect(h.store.run("test_job", "org-a", HOUR)).toMatchObject({ errorCode: "DEADLINE", cursor: "after-1", failures: 0 });
  });

  it("J1 counts a deadline cut with no committed progress as a failure, whatever cursor the job claims", async () => {
    const h = harness(
      job(async () => {
        h.clock.ms += DEFAULT_TIMING.deadlineSeconds * 1000;
        return { status: "PARTIAL", rowsWritten: 0, summary: {}, cursor: "claimed" } as JobRunResult;
      }),
    );
    await handleJobRequest(request({ jobParam: "test_job" }), h.deps);
    expect(h.store.run("test_job", "org-a", HOUR)).toMatchObject({ errorCode: "DEADLINE", cursor: null, failures: 1 });
  });

  it("J2 accepts a commit within the grace after the deadline, and refuses one after it", async () => {
    const h = harness(
      job(async (ctx) => {
        h.clock.ms += DEFAULT_TIMING.deadlineSeconds * 1000 + 1;
        await ctx.commit(async (tx) => tx.write("late-but-in-grace"));
        h.clock.ms += COMMIT_GRACE_SECONDS * 1000;
        await ctx.commit(async (tx) => tx.write("ignored-shouldStop"));
        return complete();
      }),
    );
    const response = await handleJobRequest(request({ jobParam: "test_job" }), h.deps);
    expect(response).toMatchObject({ status: 500, body: { counts: { FAILED: 1 } } });
    expect(h.store.committed).toEqual(["late-but-in-grace"]);
    expect(h.store.run("test_job", "org-a", HOUR)).toMatchObject({ status: "FAILED", errorCode: "DEADLINE_EXCEEDED", failures: 1 });
  });
});
