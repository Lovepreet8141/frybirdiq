/**
 * One job request, start to finish — everything the route does except
 * reading the request and writing the response.
 *
 * DESIGN.md §3 with DESIGN-v2-DELTA.md §3 and the RELIABILITY review of
 * ff7b92b. The route (slice S8) stays thin: it passes the headers, the job
 * segment and the parsed body, plus a store (slice S7) that owns every SQL
 * statement. This file decides.
 *
 * For each period (oldest first) and each org — one "unit" — claim, decide,
 * run under a lease with heartbeats, finish. A unit that throws is counted
 * FAILED and the next unit still runs. The whole request shares one
 * deadline: once it passes, no new unit starts, heartbeats stop (so a hung
 * job's lease lapses and a retry can take over), and the answer is 500 so
 * the timer's retry picks up where this left off.
 *
 * Status codes: 404 with no body for any refusal (auth, unknown job, bad
 * body); 200 when every unit succeeded, was already done, or is being done
 * by another live run; 500 otherwise.
 */
import { z } from "zod";

import { authorizeJobRequest, type HeaderReader, type JobSecrets } from "./auth";
import { decideClaim, type ClaimRead, type ExpectedRow, type JobRunRow, type JobTrigger } from "./claim-decision";
import type { JobContext, JobRunResult } from "./context";
import { LeaseLostError, isLeaseLost, type Fence, type LeaseToken } from "./fence";
import { checkManualPeriod, periodBounds, scheduledPeriods } from "./period";
import { JOB_REGISTRY, type JobDefinition } from "./registry";

export type ClaimRequest = {
  readonly job: string;
  readonly orgId: string;
  readonly periodKey: string;
  readonly trigger: JobTrigger;
  readonly leaseOwner: string;
  readonly leaseSeconds: number;
};

type Summary = Readonly<Record<string, number>>;

/**
 * How a run ended, as the store must record it. `failures` is the new
 * absolute value. The cursor is never written here except by DEADLINE: the
 * cursor committed with the last chunk stays as it is.
 */
export type FinishOutcome =
  | { readonly status: "SUCCEEDED"; readonly rowsWritten: number; readonly summary: Summary }
  | {
      /** Stored as status FAILED, error_code DEADLINE, with this cursor. */
      readonly status: "DEADLINE";
      readonly rowsWritten: number;
      readonly summary: Summary;
      readonly cursor: string;
      readonly failures: number;
    }
  | {
      readonly status: "FAILED";
      readonly errorCode: string;
      readonly errorMessage: string | null;
      readonly rowsWritten: number;
      readonly summary: Summary;
      readonly failures: number;
    };

/** Everything the runner needs from the database. Implemented in slice S7; every time is the database's now(). */
export interface JobRunStore<Tx = unknown> extends Fence<Tx> {
  dbNow(): Promise<Date>;
  listOrgIds(): Promise<readonly string[]>;
  /** INSERT … ON CONFLICT (job, org_id, period_key) DO NOTHING RETURNING, else the existing row. */
  claim(request: ClaimRequest): Promise<ClaimRead>;
  /** CAS on `expected` (see fence.ts C1); sets RUNNING, attempt, failures, owner and lease. Null if the row changed. */
  takeover(
    expected: ExpectedRow,
    next: {
      readonly attempt: number;
      readonly failures: number;
      readonly leaseOwner: string;
      readonly trigger: JobTrigger;
      readonly leaseSeconds: number;
    },
  ): Promise<JobRunRow | null>;
  /** CAS on `expected`; marks a dead RUNNING row at the limit FAILED LEASE_EXPIRED. */
  closeZombie(expected: ExpectedRow): Promise<void>;
  /** Fenced like `commit`, in one statement (fence.ts C2); throws `LeaseLostError`. */
  finish(token: LeaseToken, outcome: FinishOutcome): Promise<void>;
  /** Whether a heavy job other than `job` holds a live lease. */
  heavyRunLive(job: string): Promise<boolean>;
}

export type HandleDeps<Tx = unknown> = {
  readonly secrets: JobSecrets;
  readonly store: JobRunStore<Tx>;
  readonly newLeaseOwner: () => string;
  /** A monotonic clock in milliseconds, for the deadline only. */
  readonly monotonicMs: () => number;
  /** Calls `tick` every `ms` until the returned function is called. */
  readonly every: (ms: number, tick: () => void) => () => void;
  /** Test seam; production uses JOB_REGISTRY. */
  readonly registry?: Readonly<Record<string, JobDefinition>>;
};

export type JobRequest = {
  readonly jobParam: string;
  readonly headers: HeaderReader;
  /** The parsed JSON body, or undefined when there was none. */
  readonly body: unknown;
};

export type UnitOutcome =
  | "SUCCEEDED"
  | "PARTIAL"
  | "FAILED"
  | "NOOP"
  | "BUSY"
  | "EXHAUSTED"
  | "LEASE_LOST"
  | "HEAVY_BUSY"
  | "DEFERRED";

export type JobReport = {
  readonly job: string;
  readonly periods: readonly string[];
  readonly counts: Readonly<Record<UnitOutcome, number>>;
};

export type JobResponse = { readonly status: 404; readonly body: null } | { readonly status: 200 | 500; readonly body: JobReport | null };

const BodySchema = z.union([z.undefined(), z.null(), z.strictObject({ period: z.string().max(16).optional() })]);

const NOT_FOUND: JobResponse = { status: 404, body: null };

const OK_OUTCOMES: ReadonlySet<UnitOutcome> = new Set(["SUCCEEDED", "NOOP", "BUSY"]);

const ERROR_CODE = /^[A-Z][A-Z0-9_]{0,63}$/;

/** A stable code for a thrown error; never the message. */
export function errorCodeOf(error: unknown): string {
  const code = typeof error === "object" && error !== null && "code" in error ? (error as { code: unknown }).code : null;
  return typeof code === "string" && ERROR_CODE.test(code) ? code : "UNHANDLED";
}

/** An error message safe to store: no connection strings, tokens, emails or phone-like numbers; at most 500 characters. */
export function scrubErrorMessage(error: unknown): string | null {
  if (!(error instanceof Error)) return null;
  return error.message
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/\S+/gi, "[url]")
    .replace(/\bBearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/[^\s@]+@[^\s@]+\.[^\s@]+/g, "[email]")
    .replace(/\+?\d[\d\s-]*\d/g, (run) => (run.replace(/\D/g, "").length >= 10 ? "[number]" : run))
    .slice(0, 500);
}

export async function handleJobRequest<Tx>(request: JobRequest, deps: HandleDeps<Tx>): Promise<JobResponse> {
  const registry: Readonly<Record<string, JobDefinition>> = deps.registry ?? JOB_REGISTRY;
  const isJob = (name: string): name is string => Object.hasOwn(registry, name);

  const auth = authorizeJobRequest(request.headers, request.jobParam, deps.secrets, isJob);
  if (!auth.ok) return NOT_FOUND;
  const def = registry[auth.job]!;

  const body = BodySchema.safeParse(request.body);
  if (!body.success) return NOT_FOUND;

  const deadlineMs = deps.monotonicMs() + def.deadlineSeconds * 1000;

  let units: { key: string; trigger: JobTrigger }[];
  let orgIds: readonly string[];
  try {
    const now = await deps.store.dbNow();
    const manual = body.data?.period;
    if (manual !== undefined) {
      const check = checkManualPeriod(def.periodKind, def.target, manual, now);
      if (!check.ok) return NOT_FOUND;
      units = [{ key: check.key, trigger: "MANUAL" }];
    } else {
      const keys = scheduledPeriods(def.periodKind, def.target, def.catchUpPeriods, now);
      units = keys.map((key, i) => ({ key, trigger: i === keys.length - 1 ? "TIMER" : "CATCHUP" }));
    }
    orgIds = await deps.store.listOrgIds();
  } catch {
    return { status: 500, body: null };
  }

  const counts: Record<UnitOutcome, number> = {
    SUCCEEDED: 0,
    PARTIAL: 0,
    FAILED: 0,
    NOOP: 0,
    BUSY: 0,
    EXHAUSTED: 0,
    LEASE_LOST: 0,
    HEAVY_BUSY: 0,
    DEFERRED: 0,
  };

  for (const unit of units) {
    for (const orgId of orgIds) {
      let outcome: UnitOutcome;
      try {
        if (deps.monotonicMs() >= deadlineMs) outcome = "DEFERRED";
        else if (def.concurrency === "heavy" && (await deps.store.heavyRunLive(def.name))) outcome = "HEAVY_BUSY";
        else outcome = await runUnit(def, orgId, unit.key, unit.trigger, deadlineMs, deps);
      } catch {
        // One unit's store error must not skip the other orgs and periods.
        outcome = "FAILED";
      }
      counts[outcome] += 1;
    }
  }

  const report: JobReport = { job: def.name, periods: units.map((u) => u.key), counts };
  const allOk = (Object.keys(counts) as UnitOutcome[]).every((o) => counts[o] === 0 || OK_OUTCOMES.has(o));
  return { status: allOk ? 200 : 500, body: report };
}

async function runUnit<Tx>(
  def: JobDefinition,
  orgId: string,
  periodKey: string,
  trigger: JobTrigger,
  deadlineMs: number,
  deps: HandleDeps<Tx>,
): Promise<UnitOutcome> {
  const { store } = deps;
  const period = periodBounds(def.periodKind, periodKey);
  if (period === null) throw new Error("period key did not round-trip");

  const dbNow = await store.dbNow();
  const leaseOwner = deps.newLeaseOwner();
  const read = await store.claim({ job: def.name, orgId, periodKey, trigger, leaseOwner, leaseSeconds: def.leaseSeconds });
  const decision = decideClaim(read, def.maxAttempts, dbNow);

  let row: JobRunRow;
  switch (decision.kind) {
    case "NOOP":
      return "NOOP";
    case "BUSY":
      return "BUSY";
    case "EXHAUSTED":
      if (decision.closeZombie !== null) await store.closeZombie(decision.closeZombie);
      return "EXHAUSTED";
    case "TAKEOVER": {
      const taken = await store.takeover(decision.expected, {
        attempt: decision.nextAttempt,
        failures: decision.nextFailures,
        leaseOwner,
        trigger,
        leaseSeconds: def.leaseSeconds,
      });
      if (taken === null) return "BUSY";
      row = taken;
      break;
    }
    case "RUN":
      row = decision.row;
      break;
  }
  // Defensive: only ever run under a lease this request owns.
  if (row.leaseOwner !== leaseOwner || row.status !== "RUNNING") return "BUSY";

  const token: LeaseToken = { runId: row.id, attempt: row.attempt, leaseOwner };
  const startCursor = row.cursor;
  let leaseLost = false;
  const markLost = (error: unknown) => {
    if (isLeaseLost(error)) leaseLost = true;
  };
  const pastDeadline = () => deps.monotonicMs() >= deadlineMs;

  const ctx: JobContext<Tx> = {
    orgId,
    periodKey,
    period,
    trigger,
    runId: row.id,
    attempt: row.attempt,
    resumeCursor: startCursor,
    commit: async (write, options) => {
      if (leaseLost) throw new LeaseLostError(token);
      try {
        return await store.commit(token, def.leaseSeconds, write, options?.cursor);
      } catch (error) {
        markLost(error);
        throw error;
      }
    },
    shouldStop: () => leaseLost || pastDeadline(),
  };

  let stopHeartbeat = () => {};
  stopHeartbeat = deps.every(def.heartbeatSeconds * 1000, () => {
    // Past the deadline the job should already have stopped. If it has not,
    // it is hung: let the lease lapse so a retry can take over (review M1).
    if (pastDeadline()) {
      stopHeartbeat();
      return;
    }
    store.heartbeat(token, def.leaseSeconds).catch(markLost);
  });

  let result: JobRunResult | null = null;
  let failure: unknown = null;
  try {
    result = await def.run(ctx as JobContext);
  } catch (error) {
    failure = error;
  } finally {
    stopHeartbeat();
  }

  if (leaseLost || isLeaseLost(failure)) return "LEASE_LOST";

  let outcome: FinishOutcome;
  let reported: UnitOutcome;
  if (result === null) {
    outcome = {
      status: "FAILED",
      errorCode: errorCodeOf(failure),
      errorMessage: scrubErrorMessage(failure),
      rowsWritten: 0,
      summary: {},
      failures: row.failures + 1,
    };
    reported = "FAILED";
  } else if (result.status === "PARTIAL") {
    // A deadline cut that moved the cursor is progress, not a failure (review M2).
    const progressed = result.cursor !== startCursor;
    outcome = {
      status: "DEADLINE",
      rowsWritten: result.rowsWritten,
      summary: result.summary,
      cursor: result.cursor,
      failures: progressed ? row.failures : row.failures + 1,
    };
    reported = "PARTIAL";
  } else {
    outcome = { status: "SUCCEEDED", rowsWritten: result.rowsWritten, summary: result.summary };
    reported = "SUCCEEDED";
  }

  try {
    await store.finish(token, outcome);
  } catch (error) {
    if (isLeaseLost(error)) return "LEASE_LOST";
    throw error;
  }
  return reported;
}
