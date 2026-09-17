import "server-only";

/**
 * iq_job_runs — the Postgres implementation of the job runner's store
 * (`JobRunStore` in src/lib/jobs/handle.ts).
 *
 * DESIGN-v2-DELTA.md §3 and the SQL contract in src/lib/jobs/fence.ts, with
 * the RELIABILITY conditions:
 *
 * - claim: INSERT … ON CONFLICT (job, org_id, period_key) DO NOTHING
 *   RETURNING, else read the existing row.
 * - takeover (C1): UPDATE … WHERE id, org, status, attempt, lease_owner AND
 *   (status = 'FAILED' OR lease_expires_at <= now()). It waits behind an open
 *   chunk's row lock and then matches nothing if that chunk renewed the lease.
 * - fence: every chunk is one transaction whose first statement is the fenced
 *   UPDATE (lease renewed, cursor saved); zero rows throws LeaseLostError and
 *   the chunk rolls back. Heartbeat and finish (C2) are the same UPDATE,
 *   finish setting the status in that one statement.
 * - closeZombie (J3): also requires lease_expires_at <= now(), and counts the
 *   lost lease: failures = failures + 1.
 * - every time is the database's now().
 * - the pool (postgres-js, default 10) keeps at least 2 connections (C3), so a
 *   heartbeat does not queue behind its own open chunk.
 *
 * Org scoping: the app connects as `postgres`, which bypasses RLS. A store
 * learns each run's org when it claims it, and every later statement filters
 * on that org; a token for a run this store never claimed is refused as a
 * lost lease. A job never sees a transaction: `readRepos` and the argument of
 * `commit` are `iqRepos` / `iqWriteRepos`, closures over that same org (and,
 * for writes, the chunk's transaction and this run's lease). Two statements are deliberately cross-org: `listOrgIds` (the
 * runner loops over every org) and `heavyRunLive` (heavy jobs share one
 * machine, whatever org they run for).
 */

import { and, eq, gt, inArray, lte, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { iqJobRuns, orders, organizations } from "@/db/schema";
import { businessDateSql, endOfBusinessDay, startOfBusinessDay } from "@/lib/iq/metrics";
import { JOB_RUN_STATUSES, type ClaimRead, type ExpectedRow, type JobRunRow, type JobRunStatus, type JobTrigger } from "@/lib/jobs/claim-decision";
import { LeaseLostError, type LeaseToken } from "@/lib/jobs/fence";
import type { ClaimRequest, FinishOutcome, JobRunStore } from "@/lib/jobs/handle";
import { DayLockBusy, DayTimeout, type FactsParity, type JobReadRepos, type JobWriteRepos } from "@/lib/jobs/repos";
import { getProfitAndLoss } from "./expenses";
import { DayLockBusyError, DayTimeoutError, readDailyFacts, recomputeDay } from "./iq-facts";
import { getInsight, listInsights, readFactFigures, writeInsight, type IqTx } from "./iq-insights";
import { computeTrustDay } from "./iq-trust";
import { listOpenRecommendations, proposeRecommendation } from "./iq-recommendations";

/** The first IST business day an org has history for: its opened_on date, else the day of its first order. */
async function factsHistoryStart(orgId: string): Promise<string | null> {
  const [org] = await db().select({ openedOn: organizations.openedOn }).from(organizations).where(eq(organizations.id, orgId));
  if (org?.openedOn) return org.openedOn;
  const [first] = await db()
    .select({ day: sql<string | null>`min(${sql.raw(businessDateSql("created_at"))})::text` })
    .from(orders)
    .where(eq(orders.orgId, orgId));
  return first?.day ?? null;
}

type ParityRead = FactsParity & { readonly fingerprint: string };

/** One comparison of Σ daily facts with getProfitAndLoss for [from, to]. */
async function readParity(orgId: string, from: string, to: string): Promise<ParityRead> {
  const facts = await readDailyFacts(orgId, from, to);
  const pnl = await getProfitAndLoss(orgId, { from: startOfBusinessDay(from), to: endOfBusinessDay(to), label: "facts parity" });
  const sum = (rows: readonly { readonly amount: bigint }[]) => rows.reduce((total, row) => total + row.amount, 0n);
  const expected: Record<string, bigint> = {
    revenue_net: pnl.revenue,
    orders_paid: BigInt(pnl.orderCount),
    expense_direct: sum(pnl.direct),
    expense_operating: sum(pnl.fixed),
    expense_nonoperating: sum(pnl.nonOperating),
  };
  const actual = Object.fromEntries(Object.keys(expected).map((metric) => [metric, facts.totals[metric as keyof typeof facts.totals] ?? 0n]));
  const mismatchedMetrics = Object.keys(expected).filter((metric) => actual[metric] !== expected[metric]);
  const fingerprint = JSON.stringify({ actual, expected, missing: facts.missingDates }, (_k, v: unknown) => (typeof v === "bigint" ? v.toString() : v));
  return { ok: mismatchedMetrics.length === 0 && facts.missingDates.length === 0, mismatchedMetrics, missingDays: facts.missingDates.length, fingerprint };
}

/**
 * The IQ-1 monthly sum check: Σ daily facts over [from, to] against
 * getProfitAndLoss for the same IST days — revenue, paid orders and each
 * expense group. Missing days are reported, not treated as zero.
 *
 * RELIABILITY (iq1-s8r E) asks for both reads in one REPEATABLE READ snapshot.
 * readDailyFacts and getProfitAndLoss each open their own connections and
 * take no transaction (ANALYTICS-DATA's and FINANCE-LEDGER's files), so until
 * they do, a mismatch is only believed when two consecutive reads agree on
 * every compared figure: a write landing between the facts and the P&L read
 * changes the second read and is re-checked, while a real divergence reads
 * the same twice.
 */
async function checkFactsParity(orgId: string, from: string, to: string): Promise<FactsParity> {
  let previous: ParityRead | null = null;
  for (let round = 0; round < 3; round += 1) {
    const read = await readParity(orgId, from, to);
    if (read.ok || (previous !== null && previous.fingerprint === read.fingerprint)) {
      return { ok: read.ok, mismatchedMetrics: read.mismatchedMetrics, missingDays: read.missingDays };
    }
    previous = read;
  }
  return { ok: previous!.ok, mismatchedMetrics: previous!.mismatchedMetrics, missingDays: previous!.missingDays };
}

/** The iq-* reads a job may make, with `orgId` closed over. */
export function iqRepos(orgId: string): JobReadRepos {
  return {
    factsHistoryStart: () => factsHistoryStart(orgId),
    checkFactsParity: (from, to) => checkFactsParity(orgId, from, to),
    listInsights: (...args) => listInsights(orgId, ...args),
    getInsight: (...args) => getInsight(orgId, ...args),
    readFactFigures: (...args) => readFactFigures(orgId, ...args),
    listOpenRecommendations: (...args) => listOpenRecommendations(orgId, ...args),
  };
}

/**
 * The day-lock errors become their job-level forms, so job code never imports
 * a repository: DayLockBusyError -> DayLockBusy (DAY_LOCK_BUSY, contention)
 * and DayTimeoutError -> DayTimeout (DAY_TIMEOUT, a counted failure).
 */
async function mapDayLockBusy<T>(date: string, work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof DayLockBusyError) throw new DayLockBusy(date);
    if (error instanceof DayTimeoutError) throw new DayTimeout(date);
    throw error;
  }
}

/** The iq-* writes a job may make inside one fenced chunk: transaction, lease and org closed over. */
export function iqWriteRepos(tx: IqTx, lease: LeaseToken & { readonly orgId: string }): JobWriteRepos {
  return {
    // recomputeDay runs its own REPEATABLE READ transaction under a per-day
    // advisory lock, so it cannot share the chunk's transaction. The chunk's
    // fence has already checked the lease; the chunk (and its cursor) commits
    // after the day does. The recompute is idempotent, so a crash in between
    // only means the day is done again on resume.
    recomputeDay: (date, budget) => mapDayLockBusy(date, () => recomputeDay(lease.orgId, date, { jobRunId: lease.runId, ...budget })),
    // Same lock discipline as recomputeDay. appNow is left to default: trust decides "today" (T5) itself.
    computeTrustDay: (date, budget) => mapDayLockBusy(date, () => computeTrustDay(lease.orgId, date, { jobRunId: lease.runId, ...budget })),
    writeInsight: (...args) => writeInsight(tx, lease, ...args),
    proposeRecommendation: (...args) => proposeRecommendation(tx, lease, ...args),
  };
}

export type JobRunStoreOptions = {
  /** Recorded on every run: the deployed commit. */
  readonly codeVersion: string;
  /** Registry names whose concurrency is "heavy". */
  readonly heavyJobs: readonly string[];
};

const ROW = {
  id: iqJobRuns.id,
  status: iqJobRuns.status,
  attempt: iqJobRuns.attempt,
  failures: iqJobRuns.failures,
  leaseOwner: iqJobRuns.leaseOwner,
  leaseExpiresAt: iqJobRuns.leaseExpiresAt,
  cursor: iqJobRuns.cursor,
  errorCode: iqJobRuns.errorCode,
};

type RawRow = {
  id: string;
  status: string;
  attempt: number;
  failures: number;
  leaseOwner: string;
  leaseExpiresAt: Date;
  cursor: string | null;
  errorCode: string | null;
};

const isStatus = (value: string): value is JobRunStatus => (JOB_RUN_STATUSES as readonly string[]).includes(value);

function toRow(raw: RawRow): JobRunRow {
  if (!isStatus(raw.status)) throw new Error("iq-job-runs: unknown status in a stored row");
  return { ...raw, status: raw.status };
}

const secondsFromNow = (seconds: number): SQL => sql`now() + make_interval(secs => ${seconds})`;

export function createJobRunStore(options: JobRunStoreOptions): JobRunStore<JobWriteRepos> {
  return new PostgresJobRunStore(options);
}

class PostgresJobRunStore implements JobRunStore<JobWriteRepos> {
  /** run id → org id, learned from this store's own claims. */
  private readonly orgByRun = new Map<string, string>();

  constructor(private readonly options: JobRunStoreOptions) {}

  async dbNow(): Promise<Date> {
    const [row] = await db().execute<{ now: string | Date }>(sql`SELECT now() AS now`);
    return new Date(row!.now);
  }

  async listOrgIds(): Promise<readonly string[]> {
    const rows = await db().select({ id: organizations.id }).from(organizations).orderBy(organizations.createdAt);
    return rows.map((r) => r.id);
  }

  async claim(request: ClaimRequest): Promise<ClaimRead> {
    const [inserted] = await db()
      .insert(iqJobRuns)
      .values({
        orgId: request.orgId,
        job: request.job,
        periodKey: request.periodKey,
        status: "RUNNING",
        trigger: request.trigger,
        attempt: 1,
        failures: 0,
        leaseOwner: request.leaseOwner,
        leaseExpiresAt: secondsFromNow(request.leaseSeconds),
        deadlineAt: secondsFromNow(request.deadlineSeconds),
        codeVersion: this.options.codeVersion,
      })
      .onConflictDoNothing({ target: [iqJobRuns.job, iqJobRuns.orgId, iqJobRuns.periodKey] })
      .returning(ROW);
    if (inserted) {
      this.orgByRun.set(inserted.id, request.orgId);
      return { inserted: true, row: toRow(inserted) };
    }

    const [existing] = await db()
      .select(ROW)
      .from(iqJobRuns)
      .where(and(eq(iqJobRuns.job, request.job), eq(iqJobRuns.orgId, request.orgId), eq(iqJobRuns.periodKey, request.periodKey)));
    if (!existing) throw new Error("iq-job-runs: claim conflicted but no row was found");
    this.orgByRun.set(existing.id, request.orgId);
    return { inserted: false, row: toRow(existing) };
  }

  async takeover(
    expected: ExpectedRow,
    next: {
      readonly attempt: number;
      readonly failures: number;
      readonly leaseOwner: string;
      readonly trigger: JobTrigger;
      readonly leaseSeconds: number;
      readonly deadlineSeconds: number;
    },
  ): Promise<JobRunRow | null> {
    const orgId = this.orgByRun.get(expected.id);
    if (orgId === undefined) return null;
    const [row] = await db()
      .update(iqJobRuns)
      .set({
        status: "RUNNING",
        trigger: next.trigger,
        attempt: next.attempt,
        failures: next.failures,
        leaseOwner: next.leaseOwner,
        leaseExpiresAt: secondsFromNow(next.leaseSeconds),
        deadlineAt: secondsFromNow(next.deadlineSeconds),
        heartbeatAt: null,
        startedAt: sql`now()`,
        finishedAt: null,
        durationMs: null,
        errorCode: null,
        errorMessage: null,
        codeVersion: this.options.codeVersion,
        updatedAt: sql`now()`,
      })
      .where(
        and(
          this.expectedRow(expected, orgId),
          or(eq(iqJobRuns.status, "FAILED"), lte(iqJobRuns.leaseExpiresAt, sql`now()`)),
        ),
      )
      .returning(ROW);
    return row ? toRow(row) : null;
  }

  async closeZombie(expected: ExpectedRow): Promise<void> {
    const orgId = this.orgByRun.get(expected.id);
    if (orgId === undefined) return;
    await db()
      .update(iqJobRuns)
      .set({
        status: "FAILED",
        failures: sql`${iqJobRuns.failures} + 1`,
        errorCode: "LEASE_EXPIRED",
        finishedAt: sql`now()`,
        updatedAt: sql`now()`,
      })
      .where(and(this.expectedRow(expected, orgId), eq(iqJobRuns.status, "RUNNING"), lte(iqJobRuns.leaseExpiresAt, sql`now()`)));
  }

  async commit<T>(token: LeaseToken, leaseSeconds: number, write: (repos: JobWriteRepos) => Promise<T>, cursor?: string): Promise<T> {
    const orgId = this.orgByRun.get(token.runId);
    if (orgId === undefined) throw new LeaseLostError(token);
    const fence = this.fence(token);
    return db().transaction(async (tx) => {
      const held = await tx
        .update(iqJobRuns)
        .set({
          heartbeatAt: sql`now()`,
          leaseExpiresAt: secondsFromNow(leaseSeconds),
          updatedAt: sql`now()`,
          ...(cursor === undefined ? {} : { cursor }),
        })
        .where(fence)
        .returning({ id: iqJobRuns.id });
      if (held.length === 0) throw new LeaseLostError(token);
      return write(iqWriteRepos(tx, { ...token, orgId }));
    });
  }

  readRepos(token: LeaseToken): JobReadRepos {
    const orgId = this.orgByRun.get(token.runId);
    if (orgId === undefined) throw new LeaseLostError(token);
    return iqRepos(orgId);
  }

  async heartbeat(token: LeaseToken, leaseSeconds: number): Promise<void> {
    const held = await db()
      .update(iqJobRuns)
      .set({ heartbeatAt: sql`now()`, leaseExpiresAt: secondsFromNow(leaseSeconds), updatedAt: sql`now()` })
      .where(this.fence(token))
      .returning({ id: iqJobRuns.id });
    if (held.length === 0) throw new LeaseLostError(token);
  }

  async finish(token: LeaseToken, outcome: FinishOutcome): Promise<void> {
    const common = {
      finishedAt: sql`now()`,
      durationMs: sql`GREATEST(0, (extract(epoch FROM now() - ${iqJobRuns.startedAt}) * 1000)::int)`,
      rowsWritten: outcome.rowsWritten,
      summary: outcome.summary,
      // The lease ends with the run.
      leaseExpiresAt: sql`now()`,
      updatedAt: sql`now()`,
    };
    const set =
      outcome.status === "SUCCEEDED"
        ? { ...common, status: "SUCCEEDED", cursor: null, errorCode: null, errorMessage: null }
        : outcome.status === "DEADLINE"
          ? { ...common, status: "FAILED", errorCode: outcome.errorCode, errorMessage: null, cursor: outcome.cursor, failures: outcome.failures }
          : { ...common, status: "FAILED", errorCode: outcome.errorCode, errorMessage: outcome.errorMessage, failures: outcome.failures };

    const held = await db().update(iqJobRuns).set(set).where(this.fence(token)).returning({ id: iqJobRuns.id });
    if (held.length === 0) throw new LeaseLostError(token);
  }

  async heavyRunLive(job: string): Promise<boolean> {
    const others = this.options.heavyJobs.filter((name) => name !== job);
    if (others.length === 0) return false;
    const rows = await db()
      .select({ id: iqJobRuns.id })
      .from(iqJobRuns)
      .where(and(inArray(iqJobRuns.job, others), eq(iqJobRuns.status, "RUNNING"), gt(iqJobRuns.leaseExpiresAt, sql`now()`)))
      .limit(1);
    return rows.length > 0;
  }

  /** The fence WHERE clause (fence.ts). A run this store never claimed can never match. */
  private fence(token: LeaseToken): SQL {
    const orgId = this.orgByRun.get(token.runId);
    if (orgId === undefined) return sql`false`;
    return and(
      eq(iqJobRuns.id, token.runId),
      eq(iqJobRuns.orgId, orgId),
      eq(iqJobRuns.attempt, token.attempt),
      eq(iqJobRuns.leaseOwner, token.leaseOwner),
      eq(iqJobRuns.status, "RUNNING"),
      gt(iqJobRuns.leaseExpiresAt, sql`now()`),
    )!;
  }

  private expectedRow(expected: ExpectedRow, orgId: string): SQL {
    return and(
      eq(iqJobRuns.id, expected.id),
      eq(iqJobRuns.orgId, orgId),
      eq(iqJobRuns.status, expected.status),
      eq(iqJobRuns.attempt, expected.attempt),
      eq(iqJobRuns.leaseOwner, expected.leaseOwner),
    )!;
  }
}
