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

import { and, eq, gt, gte, inArray, like, lte, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { iqDailyTrust, iqJobRuns, orders, organizations } from "@/db/schema";
import { addDays } from "@/lib/dates";
import type { BriefFiguresRead, BriefPeriods } from "@/lib/iq/brief/brief-job";
import type { CheckRun } from "@/lib/iq/brief/compose";
import type { CheckName } from "@/lib/iq/brief/templates";
import { detectDayFrom, type DayFacts, type DayTrustRow } from "@/lib/iq/detect/day";
import { DETECT_JOB_NAME } from "@/lib/iq/detect/detect-job";
import { pulseDayFrom, type OpeningHours, type PulseDay } from "@/lib/iq/detect/pulse";
import type { DetectDay } from "@/lib/iq/detect/rules";
import type { Observed } from "@/lib/iq/engine";
import { observed } from "@/lib/iq/engine/observed-factory";
import { TRUST_SIGNAL_IDS, businessDateSql, endOfBusinessDay, netCollected, startOfBusinessDay, type TrustSignalId } from "@/lib/iq/metrics";
import { TRUST_GRADES, type TrustGrade } from "@/lib/iq/trust";
import { paise } from "@/lib/money";
import { briefFiguresFrom, type BriefSpanRead } from "@/lib/jobs/brief-figures";
import { FACTS_NIGHTLY_JOB, nightlyDates } from "@/lib/jobs/facts-plan";
import { INTRADAY_WRITER_JOB } from "@/lib/jobs/jobs/pulse";
import { JOB_RUN_STATUSES, type ClaimRead, type ExpectedRow, type JobRunRow, type JobRunStatus, type JobTrigger } from "@/lib/jobs/claim-decision";
import { LeaseLostError, type LeaseToken } from "@/lib/jobs/fence";
import type { ClaimRequest, FinishOutcome, JobRunStore } from "@/lib/jobs/handle";
import { DayLockBusy, DayTimeout, type FactsParity, type JobReadRepos, type JobWriteRepos } from "@/lib/jobs/repos";
import { saleSetWhere } from "./analytics";
import { getProfitAndLoss } from "./expenses";
import { countStuckRefundFollowUps, healLostRefundFollowUps } from "./payments";
import { PURGE_BATCH, purgeRiderPositions } from "./rider-tracking";
import { DayLockBusyError, DayTimeoutError, assertBusinessDate, purgeIntradayFacts, readDailyFacts, readIntradayFacts, rebuildIntradayDay, recomputeDay } from "./iq-facts";
import { expireInsights, getInsight, listInsights, readFactFigures, writeInsight, type IqTx } from "./iq-insights";
import { readRecon } from "./iq-recon";
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

/** The org's Opening date, or null if not set — never falls back to the first order (`analytics-start-date`). */
async function readOpenedOn(orgId: string): Promise<string | null> {
  const [org] = await db().select({ openedOn: organizations.openedOn }).from(organizations).where(eq(organizations.id, orgId));
  return org?.openedOn ?? null;
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

/** This org's stored trust rows for `dates`, keeping only signals and grades this build knows. */
async function readDayTrustRows(orgId: string, dates: readonly string[]): Promise<(DayTrustRow & { readonly date: string })[]> {
  const unique = [...new Set(dates)];
  if (unique.length === 0) return [];
  const rows = await db()
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
  const knownSignal = (id: string): id is TrustSignalId => (TRUST_SIGNAL_IDS as readonly string[]).includes(id);
  const knownGrade = (grade: string): grade is TrustGrade => (TRUST_GRADES as readonly string[]).includes(grade);
  return rows
    .filter((row) => knownSignal(row.signalId) && knownGrade(row.grade))
    .map((row) => ({ date: row.date, signalId: row.signalId as TrustSignalId, grade: row.grade as TrustGrade, numerator: row.numerator, denominator: row.denominator, computedAt: row.computedAt }));
}

/**
 * The detectors' view of each date (IQ-2 S3 `DetectDay`). This repository does
 * only the org-scoped reads — each day's summed daily facts and the day's
 * iq_daily_trust rows — and hands them to IQ-ENGINE's pure `detectDayFrom`,
 * which owns the figures and the trust rule (ARCHITECT review of 56fc9ba).
 *
 * Facts are read per date: `readDailyFacts` sums over its range, and the dates
 * are not contiguous (the day, the day before, and 8 same-weekday days), so one
 * call over min..max would add the days together.
 */
async function readDetectDays(orgId: string, dates: readonly string[]): Promise<DetectDay[]> {
  if (dates.length === 0) return [];
  const trustRows = await readDayTrustRows(orgId, dates);

  const days: DetectDay[] = [];
  for (const date of dates) {
    const facts = await readDailyFacts(orgId, date, date);
    const dayFacts: DayFacts = { computed: facts.computedDates.includes(date), totals: facts.totals, breakdowns: facts.breakdowns };
    const dayTrust: DayTrustRow[] = trustRows.filter((row) => row.date === date);
    // TODO(IQ-2 S4, FINANCE-LEDGER): parityFlagged comes from S4's per-day recon.facts_parity flag once it exists
    // (god ruling on iq2-s7: detectDayFrom's false is accepted until then).
    days.push(detectDayFrom(date, dayFacts, dayTrust, observed));
  }
  return days;
}

/** Every IST date in [from, to], inclusive. */
function datesInSpan(span: { readonly from: string; readonly to: string }): string[] {
  const dates: string[] = [];
  for (let date = span.from; date <= span.to; date = addDays(date, 1)) dates.push(date);
  return dates;
}

async function readBriefSpan(orgId: string, span: { readonly from: string; readonly to: string }): Promise<BriefSpanRead> {
  const [facts, trust] = await Promise.all([readDailyFacts(orgId, span.from, span.to), readDayTrustRows(orgId, datesInSpan(span))]);
  return { computed: facts.computedDates.length > 0, totals: facts.totals, trust };
}

/**
 * The daily brief's figures (IQ-2 S10 `BriefFiguresRead`). Same division as
 * readDetectDays: org-scoped reads here, every figure and its trust in the pure
 * `briefFiguresFrom`, so the brief's four shared day figures are the detectors'
 * own numbers rather than a second derivation of them.
 */
async function readBriefFigures(orgId: string, periods: BriefPeriods): Promise<BriefFiguresRead> {
  const date = periods.day.to;
  const [dayFacts, dayTrust, monthToDate, sameDaysLastMonth] = await Promise.all([
    readDailyFacts(orgId, date, date),
    readDayTrustRows(orgId, [date]),
    readBriefSpan(orgId, periods.monthToDate),
    readBriefSpan(orgId, periods.sameDaysLastMonth),
  ]);
  const captured = dayFacts.totals.captured_amount;
  const refunded = dayFacts.totals.refunds_amount;
  const day = {
    date,
    facts: { computed: dayFacts.computedDates.includes(date), totals: dayFacts.totals, breakdowns: dayFacts.breakdowns },
    trust: dayTrust,
    // The catalog's own helper, so the brief's "Collected after refunds" is the metric, not a second subtraction.
    netCollected: captured === undefined && refunded === undefined ? null : netCollected(paise(captured ?? 0n), paise(refunded ?? 0n)),
  };
  return briefFiguresFrom(day, monthToDate, sameDaysLastMonth, observed);
}

/**
 * The org's opening hours, as the service pulse reads them (IQ-2 S9). Stored
 * "HH:MM" strings; the pure rules decide what an unusable pair means.
 */
async function readOpeningHours(orgId: string): Promise<OpeningHours> {
  const [org] = await db()
    .select({ opening: organizations.openingTime, closing: organizations.closingTime })
    .from(organizations)
    .where(eq(organizations.id, orgId))
    .limit(1);
  if (org === undefined) throw new Error(`iq-job-runs: org ${orgId} not found`);
  return { opening: org.opening, closing: org.closing };
}

/**
 * Whether an intraday writer run has finished covering the bucket that ended
 * at `bucketEnd` (RELIABILITY C8/U3): a SUCCEEDED iq-facts-intraday run of this
 * org that STARTED at or after that instant, so its read of today included the
 * whole bucket. Without one the pulse refuses to evaluate rather than read a
 * bucket the writer has not filled yet.
 */
async function intradayFreshAt(orgId: string, bucketEnd: string): Promise<boolean> {
  const [run] = await db()
    .select({ id: iqJobRuns.id })
    .from(iqJobRuns)
    .where(
      and(
        eq(iqJobRuns.orgId, orgId),
        eq(iqJobRuns.job, INTRADAY_WRITER_JOB),
        eq(iqJobRuns.status, "SUCCEEDED"),
        gte(iqJobRuns.startedAt, new Date(bucketEnd)),
      ),
    )
    .limit(1);
  return run !== undefined;
}

/**
 * The pulse's view of each IST date: this org's current-version intraday
 * buckets, handed to IQ-ENGINE's pure `pulseDayFrom` (same division as
 * readDetectDays).
 *
 * `computed` is rows.length > 0, because an intraday rebuild writes no row for
 * a bucket with nothing in it and none at all for an empty day: a day that was
 * never built and a day with no orders are indistinguishable in the table. It
 * fails safe — an unbuilt day is left out of the baseline and never fires —
 * and today's run has already proved a writer ran (`intradayFreshAt`).
 * TODO(IQ-2, ANALYTICS-DATA): a per-day "intraday built" marker would let a
 * genuinely empty day count as computed.
 */
async function readPulseDays(orgId: string, dates: readonly string[]): Promise<PulseDay[]> {
  const days: PulseDay[] = [];
  for (const date of [...new Set(dates)]) {
    const buckets = await readIntradayFacts(orgId, date);
    const midnight = startOfBusinessDay(date).getTime();
    const rows = buckets.map((bucket) => ({
      startMinute: Math.round((bucket.bucketStart.getTime() - midnight) / 60_000),
      metricId: bucket.metricId,
      value: bucket.value,
    }));
    days.push(pulseDayFrom(date, rows.length > 0, rows, observed));
  }
  return days;
}

/** Paid orders created in [from, to) (IST timestamps), the same sale set the facts use (R2.8). */
async function countPaidOrders(orgId: string, from: string, to: string): Promise<Observed> {
  const [row] = await db()
    .select({ count: sql<number>`count(*)::int` })
    .from(orders)
    .where(saleSetWhere(orgId, { from: new Date(from), to: new Date(to) }));
  return observed({ unit: "count", value: row?.count ?? 0 });
}

/** The iq-* reads a job may make, with `orgId` closed over. */
export function iqRepos(orgId: string): JobReadRepos {
  return {
    // PAYMENT-SAFETY's healer (ref-b7): its own idempotent transaction per refund, outside any chunk.
    healLostRefundFollowUps: (options) => healLostRefundFollowUps({ orgId }, { shouldStop: options.shouldStop }),
    countStuckRefundFollowUps: () => countStuckRefundFollowUps({ orgId }),
    // Lane B: rider GPS fixes are kept 24 hours. Its own short statement, outside any chunk.
    purgeRiderPositions: async () => {
      const deleted = await purgeRiderPositions(orgId, new Date(), PURGE_BATCH);
      return { deleted, more: deleted >= PURGE_BATCH };
    },
    factsHistoryStart: () => factsHistoryStart(orgId),
    readOpenedOn: () => readOpenedOn(orgId),
    checkFactsParity: (from, to) => checkFactsParity(orgId, from, to),
    factsReadyFor: (date) => factsReadyFor(orgId, date),
    readDetectDays: (dates) => readDetectDays(orgId, dates),
    // Blocked by owner decision dec-7 (food-cost target): the rule stays unevaluated until then.
    readFoodCostTarget: async () => null,
    readRecon: (...args) => readRecon(orgId, ...args),
    readBriefFigures: (periods) => readBriefFigures(orgId, periods),
    readOpeningHours: () => readOpeningHours(orgId),
    intradayFreshAt: (bucketEnd) => intradayFreshAt(orgId, bucketEnd),
    readPulseDays: (dates) => readPulseDays(orgId, dates),
    countPaidOrders: (from, to) => countPaidOrders(orgId, from, to),
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

/* ── The daily brief's D-1 run state (IQ-2 R2.10, S10a) ─────────────────── */

/**
 * The job that runs each check the brief names. Reconcile and signatures are
 * not in the registry yet (their bodies are FINANCE-LEDGER's S4 and
 * PAYMENT-SAFETY's S5): until they are, no run row exists for them and the
 * brief reads NOT_RUN, which is what actually happened — it never all-clears
 * a check that did not run.
 */
export const BRIEF_CHECK_JOBS: Readonly<Record<CheckName, string>> = {
  detect: DETECT_JOB_NAME,
  reconcile: "iq-reconcile-nightly",
  signatures: "iq-money-signatures",
};

export type BriefRunState = {
  /** How each check ended for the date. */
  readonly checks: Readonly<Record<CheckName, CheckRun>>;
  /** iq-facts-nightly's summary for the date, for `parityFromSummary`; null unless a run SUCCEEDED. */
  readonly factsSummary: Readonly<Record<string, number>> | null;
  /** iq-detect-daily's summary for the date (its `not_evaluated:<rule>:<reason>` counts); null unless a run SUCCEEDED. */
  readonly detectSummary: Readonly<Record<string, number>> | null;
};

/**
 * How the day's checks ran, for one org and one IST business day.
 *
 * A day job's period key is the date; an hourly job's is `<date>T<hour>`, so
 * both are matched and an hourly check folds over its rows. It fails closed:
 * any FAILED row makes the check FAILED, any row that is neither SUCCEEDED
 * nor FAILED (RUNNING, SKIPPED) reads NOT_RUN, and no row at all is NOT_RUN.
 * Missing hours are not counted as runs — an hourly check that ran only part
 * of the day still reads SUCCEEDED, so the brief's "no risks found" rests on
 * the rows that exist. Tightening that needs a per-hour expectation the
 * registry does not state yet.
 *
 * A summary comes only from a SUCCEEDED run: a failed run's counts are
 * partial, and the brief must read a missing parity summary as "not checked"
 * rather than as zero mismatches (R2.6).
 */
export async function readBriefRunState(orgId: string, date: string): Promise<BriefRunState> {
  // `_` is a single-character wildcard in LIKE: an unchecked date would match
  // another day's hourly period keys and report that day's checks as this day's.
  assertBusinessDate(date);
  const jobs = [...Object.values(BRIEF_CHECK_JOBS), FACTS_NIGHTLY_JOB];
  const rows = await db()
    .select({ job: iqJobRuns.job, status: iqJobRuns.status, periodKey: iqJobRuns.periodKey, summary: iqJobRuns.summary })
    .from(iqJobRuns)
    .where(
      and(
        eq(iqJobRuns.orgId, orgId),
        inArray(iqJobRuns.job, jobs),
        or(eq(iqJobRuns.periodKey, date), like(iqJobRuns.periodKey, `${date}T%`)),
      ),
    );

  const stateOf = (job: string): CheckRun => {
    const mine = rows.filter((row) => row.job === job);
    if (mine.length === 0) return "NOT_RUN";
    if (mine.some((row) => row.status === "FAILED")) return "FAILED";
    return mine.every((row) => row.status === "SUCCEEDED") ? "SUCCEEDED" : "NOT_RUN";
  };
  const summaryOf = (job: string): Readonly<Record<string, number>> | null =>
    rows.find((row) => row.job === job && row.periodKey === date && row.status === "SUCCEEDED")?.summary ?? null;

  return {
    checks: { detect: stateOf(BRIEF_CHECK_JOBS.detect), reconcile: stateOf(BRIEF_CHECK_JOBS.reconcile), signatures: stateOf(BRIEF_CHECK_JOBS.signatures) },
    factsSummary: summaryOf(FACTS_NIGHTLY_JOB),
    detectSummary: summaryOf(BRIEF_CHECK_JOBS.detect),
  };
}
