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

import { and, eq, gt, gte, inArray, lte, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { iqDailyTrust, iqJobRuns, orders, organizations } from "@/db/schema";
import { DETECT_FIGURES, FIGURE_UNITS, type DetectDay, type DetectFigureId, type DetectTrust } from "@/lib/iq/detect/rules";
import type { Observed } from "@/lib/iq/engine";
import { observed } from "@/lib/iq/engine/observed-factory";
import {
  aovNetV2,
  businessDateSql,
  channelShare,
  endOfBusinessDay,
  foodCostPctTheoretical,
  getDerivedMetric,
  getMetric,
  isDerivedMetricId,
  ratioBpsOrNull,
  startOfBusinessDay,
  type AnyMetricId,
  type TrustSignalId,
} from "@/lib/iq/metrics";
import { gradeRank, type TrustGrade } from "@/lib/iq/trust";
import { paise } from "@/lib/money";
import { FACTS_NIGHTLY_JOB, nightlyDates } from "@/lib/jobs/facts-plan";
import { JOB_RUN_STATUSES, type ClaimRead, type ExpectedRow, type JobRunRow, type JobRunStatus, type JobTrigger } from "@/lib/jobs/claim-decision";
import { LeaseLostError, type LeaseToken } from "@/lib/jobs/fence";
import type { ClaimRequest, FinishOutcome, JobRunStore } from "@/lib/jobs/handle";
import { DayLockBusy, DayTimeout, type FactsParity, type JobReadRepos, type JobWriteRepos } from "@/lib/jobs/repos";
import { getProfitAndLoss } from "./expenses";
import { DayLockBusyError, DayTimeoutError, purgeIntradayFacts, readDailyFacts, rebuildIntradayDay, recomputeDay } from "./iq-facts";
import { expireInsights, getInsight, istTimestamp, listInsights, readFactFigures, writeInsight, type IqTx } from "./iq-insights";
import { TRUST_DEFINITION_VERSION, computeTrustDay } from "./iq-trust";
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

/**
 * Whether daily facts for `date` are final (IQ-2 R2.8; RELIABILITY C4 and U1):
 * some SUCCEEDED iq-facts-nightly run of this org planned `date` and finished
 * after the day closed. Any such run counts, not only the one keyed to `date`,
 * so a night whose own facts run exhausted is unblocked by the next night's run
 * (which rebuilds the current and previous month) instead of failing forever.
 */
async function factsReadyFor(orgId: string, date: string): Promise<boolean> {
  const runs = await db()
    .select({ periodKey: iqJobRuns.periodKey })
    .from(iqJobRuns)
    .where(
      and(
        eq(iqJobRuns.orgId, orgId),
        eq(iqJobRuns.job, FACTS_NIGHTLY_JOB),
        eq(iqJobRuns.status, "SUCCEEDED"),
        gte(iqJobRuns.periodKey, date),
        gte(iqJobRuns.finishedAt, endOfBusinessDay(date)),
      ),
    );
  return runs.some((run) => nightlyDates(run.periodKey).includes(date));
}

/**
 * The stored metrics each detector figure's trust rests on. A figure built from
 * several metrics is as trusted as the weakest of their signals.
 */
const FIGURE_TRUST_METRICS: Readonly<Record<DetectFigureId, readonly AnyMetricId[]>> = {
  revenue_net: ["revenue_net"],
  orders_paid: ["orders_paid"],
  aov_net: ["aov_net"],
  discount_share: ["discount_total", "sales_gross"],
  orders_cancelled_failed: ["orders_cancelled", "orders_failed"],
  refunds_amount: ["refunds_amount"],
  sales_gross: ["sales_gross"],
  waste_cost: ["waste_cost"],
  food_cost_pct_theoretical: ["food_cost_pct_theoretical"],
  online_share: ["channel_share"],
};

function signalsOf(metricIds: readonly AnyMetricId[]): TrustSignalId[] {
  const signals: TrustSignalId[] = [];
  for (const id of metricIds) {
    const definition = isDerivedMetricId(id) ? getDerivedMetric(id) : getMetric(id);
    for (const signal of definition.trustSignals) if (!signals.includes(signal)) signals.push(signal);
  }
  return signals;
}

const asObserved = (id: DetectFigureId, value: bigint): Observed =>
  FIGURE_UNITS[id] === "paise" ? observed({ unit: "paise", value: value.toString() }) : observed({ unit: FIGURE_UNITS[id], value: Number(value) });

/**
 * The detectors' view of each date (IQ-2 S3 `DetectDay`), built only from this
 * org's stored daily facts and daily trust, with the derived figures computed by
 * the metrics catalog's own helpers (`FIGURE_INPUTS` in detect/rules.ts):
 * - a day with no computed facts has `hasFacts` false and no figures;
 * - a figure whose input is undefined (no orders, no gross sales) is absent;
 * - a day with no trust rows has no trust entries, so its rules do not evaluate;
 * - a figure's trust is the lowest grade of all its signals (a signal not scored
 *   that day is UNKNOWN), naming that signal with its stored ratio and the
 *   count of its LOW signals.
 * `parityFlagged` is false: parity is checked per month (checkFactsParity) and
 * no per-day flag exists yet — see the TODO in detect/detect-job.ts.
 */
async function readDetectDays(orgId: string, dates: readonly string[]): Promise<DetectDay[]> {
  const unique = [...new Set(dates)];
  if (unique.length === 0) return [];

  const trustRows = await db()
    .select({
      date: iqDailyTrust.businessDate,
      signalId: iqDailyTrust.signalId,
      grade: iqDailyTrust.grade,
      numerator: iqDailyTrust.numerator,
      denominator: iqDailyTrust.denominator,
      computedAt: iqDailyTrust.computedAt,
    })
    .from(iqDailyTrust)
    .where(
      and(
        eq(iqDailyTrust.orgId, orgId),
        eq(iqDailyTrust.definitionVersion, TRUST_DEFINITION_VERSION),
        inArray(iqDailyTrust.businessDate, unique),
      ),
    );

  const days: DetectDay[] = [];
  for (const date of dates) {
    const facts = await readDailyFacts(orgId, date, date);
    const hasFacts = facts.computedDates.includes(date);
    const total = (id: keyof typeof facts.totals) => facts.totals[id] ?? 0n;

    const values: Partial<Record<DetectFigureId, bigint | number | null>> = {};
    if (hasFacts) {
      const revenue = paise(total("revenue_net"));
      const onlineRevenue = paise(facts.breakdowns.revenue_net?.channel?.ONLINE ?? 0n);
      values.revenue_net = revenue;
      values.orders_paid = total("orders_paid");
      values.aov_net = aovNetV2(revenue, total("orders_paid"));
      values.discount_share = ratioBpsOrNull(paise(total("discount_total")), paise(total("sales_gross")));
      values.orders_cancelled_failed = total("orders_cancelled") + total("orders_failed");
      values.refunds_amount = total("refunds_amount");
      values.sales_gross = total("sales_gross");
      values.waste_cost = total("waste_cost");
      values.food_cost_pct_theoretical = revenue > 0n ? foodCostPctTheoretical(paise(total("food_cost_theoretical")), revenue) : null;
      values.online_share = revenue > 0n ? channelShare(onlineRevenue, revenue) : null;
    }
    const figures: Partial<Record<DetectFigureId, Observed>> = {};
    for (const id of DETECT_FIGURES) {
      const value = values[id];
      if (value !== null && value !== undefined) figures[id] = asObserved(id, BigInt(value));
    }

    const rows = trustRows.filter((row) => row.date === date);
    const trust: Partial<Record<DetectFigureId, DetectTrust>> = {};
    if (rows.length > 0) {
      const asOf = istTimestamp(new Date(Math.max(...rows.map((row) => row.computedAt.getTime()))));
      const bySignal = new Map(rows.map((row) => [row.signalId, row]));
      for (const id of DETECT_FIGURES) {
        const signals = signalsOf(FIGURE_TRUST_METRICS[id]);
        if (signals.length === 0) {
          trust[id] = { grade: "UNKNOWN", signalId: null, ratio: null, asOf, lowSignals: observed({ unit: "count", value: 0 }) };
          continue;
        }
        const gradeOf = (signal: TrustSignalId) => (bySignal.get(signal)?.grade ?? "UNKNOWN") as TrustGrade;
        let limiting = signals[0]!;
        for (const signal of signals) if (gradeRank(gradeOf(signal)) < gradeRank(gradeOf(limiting))) limiting = signal;
        const row = bySignal.get(limiting);
        trust[id] = {
          grade: gradeOf(limiting),
          signalId: limiting,
          ratio: row && row.denominator > 0n ? { numerator: row.numerator, denominator: row.denominator } : null,
          asOf,
          lowSignals: observed({ unit: "count", value: signals.filter((signal) => gradeOf(signal) === "LOW").length }),
        };
      }
    }
    // TODO(IQ-2 S4, FINANCE-LEDGER): set parityFlagged from S4's per-day recon.facts_parity flag once it exists
    // (god ruling on iq2-s7: false is accepted until then).
    days.push({ date, hasFacts, parityFlagged: false, figures, trust });
  }
  return days;
}

/** The iq-* reads a job may make, with `orgId` closed over. */
export function iqRepos(orgId: string): JobReadRepos {
  return {
    factsHistoryStart: () => factsHistoryStart(orgId),
    checkFactsParity: (from, to) => checkFactsParity(orgId, from, to),
    factsReadyFor: (date) => factsReadyFor(orgId, date),
    readDetectDays: (dates) => readDetectDays(orgId, dates),
    // Blocked by owner decision dec-7 (food-cost target): the rule stays unevaluated until then.
    readFoodCostTarget: async () => null,
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
    expireInsights: (...args) => expireInsights(tx, lease, ...args),
    proposeRecommendation: (...args) => proposeRecommendation(tx, lease, ...args),
    // Its own locked transaction, like recomputeDay (key intraday:<org>:<date>).
    rebuildIntradayDay: (date, budget) => mapDayLockBusy(date, () => rebuildIntradayDay(lease.orgId, date, { jobRunId: lease.runId, ...budget })),
    purgeIntradayFacts: (today) => purgeIntradayFacts(lease.orgId, today),
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

  get codeVersion(): string {
    return this.options.codeVersion;
  }

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
