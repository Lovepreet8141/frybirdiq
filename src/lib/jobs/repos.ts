/**
 * What a job may touch in the database — the only way it gets there.
 *
 * SECURITY condition on daa167f (DESIGN T5): the app connects as `postgres`,
 * which bypasses row-level security, so a job must never hold a raw
 * transaction or a query builder. It gets two org-bound closures instead,
 * built by the job-run store from the org it claimed the run for:
 *
 * - `ctx.repos` (JobReadRepos): reads, outside any chunk;
 * - the argument of `ctx.commit` (JobWriteRepos): writes, inside the fenced
 *   chunk transaction and under this run's lease.
 *
 * No function here takes an org id: it is closed over. Signatures follow the
 * iq-* repositories they wrap (minus the org, transaction and lease), so the
 * two cannot drift apart. Nothing here reaches a database.
 */
import type { DetectDay } from "@/lib/iq/detect/rules";
import type { Observed } from "@/lib/iq/engine";
import type * as Facts from "@/lib/repositories/iq-facts";
import type * as Insights from "@/lib/repositories/iq-insights";
import type * as Trust from "@/lib/repositories/iq-trust";
import type * as Recommendations from "@/lib/repositories/iq-recommendations";

/** `(org, ...rest) => R` becomes `(...rest) => R`. */
type WithoutOrg<F> = F extends (orgId: string, ...rest: infer A) => infer R ? (...rest: A) => R : never;
/** `(tx, lease, ...rest) => R` becomes `(...rest) => R`. */
type WithoutTxAndLease<F> = F extends (tx: never, lease: never, ...rest: infer A) => infer R ? (...rest: A) => R : never;

/** Σ daily facts against the P&L over a date range (IQ-1 monthly sum check). Counts and ids only. */
export type FactsParity = {
  readonly ok: boolean;
  /** Metric ids whose summed facts differ from the P&L. */
  readonly mismatchedMetrics: readonly string[];
  /** Days in the range with no facts at all. */
  readonly missingDays: number;
};

export type JobReadRepos = {
  /** The first IST business day this org has history for (opened_on, else its first order), or null. */
  readonly factsHistoryStart: () => Promise<string | null>;
  /** Compares Σ daily facts with getProfitAndLoss for [from, to] (IST dates, inclusive). */
  readonly checkFactsParity: (from: string, to: string) => Promise<FactsParity>;
  /**
   * Whether daily facts for `date` are final (IQ-2 R2.8 gate; RELIABILITY U1):
   * some SUCCEEDED iq-facts-nightly run planned `date` and finished after the
   * day closed. Not only the run keyed to `date` — a later night rebuilds it too.
   */
  readonly factsReadyFor: (date: string) => Promise<boolean>;
  /** The detectors' view of each date: figures from daily facts, trust from daily trust (IQ-2 S3 `DetectDay`). */
  readonly readDetectDays: (dates: readonly string[]) => Promise<readonly DetectDay[]>;
  /** The owner's food-cost target for the date's month; null until owner decision dec-7. */
  readonly readFoodCostTarget: (date: string) => Promise<Observed | null>;
  readonly listInsights: WithoutOrg<typeof Insights.listInsights>;
  readonly getInsight: WithoutOrg<typeof Insights.getInsight>;
  readonly readFactFigures: WithoutOrg<typeof Insights.readFactFigures>;
  readonly listOpenRecommendations: WithoutOrg<typeof Recommendations.listOpenRecommendations>;
};

/**
 * How long one locked day step may take: waits for another holder of the same
 * day (RELIABILITY, iq1-s7b) and each statement or idle gap inside its
 * transaction (ANALYTICS-DATA iq1-s6d).
 */
export type DayLockBudget = {
  readonly maxLockWaits: number;
  readonly lockWaitTimeoutMs: number;
  readonly statementTimeoutMs: number;
  readonly idleInTransactionTimeoutMs: number;
};

/**
 * The day stayed locked by another recompute past the budget. Nothing was
 * written. Thrown from inside a chunk so the chunk — and its cursor — rolls
 * back; the job then stops with PARTIAL and the retry starts at this day.
 */
export class DayLockBusy extends Error {
  readonly code = "DAY_LOCK_BUSY";

  constructor(readonly date: string) {
    super("day lock busy");
    this.name = "DayLockBusy";
  }
}

/**
 * A statement or an idle gap in the day's locked transaction ran past its
 * timeout. The transaction rolled back. Unlike DayLockBusy this is a fault,
 * not contention: the job lets it propagate and the run records a counted
 * failure with error_code DAY_TIMEOUT.
 */
export class DayTimeout extends Error {
  readonly code = "DAY_TIMEOUT";

  constructor(readonly date: string) {
    super("day step timed out");
    this.name = "DayTimeout";
  }
}

export type JobWriteRepos = {
  /** Rebuilds one IST business day's facts for this org, recorded against this run. Idempotent. Throws `DayLockBusy` or `DayTimeout`. */
  readonly recomputeDay: (date: string, budget: DayLockBudget) => ReturnType<typeof Facts.recomputeDay>;
  /** Scores and stores one IST business day's trust signals for this org, recorded against this run. Idempotent. Throws `DayLockBusy` or `DayTimeout`. */
  readonly computeTrustDay: (date: string, budget: DayLockBudget) => ReturnType<typeof Trust.computeTrustDay>;
  readonly writeInsight: WithoutTxAndLease<typeof Insights.writeInsight>;
  /** Expires ACTIVE insights for keys this chunk evaluated and found clear (CAS on as_of; RELIABILITY C5/C6). */
  readonly expireInsights: WithoutTxAndLease<typeof Insights.expireInsights>;
  readonly proposeRecommendation: WithoutTxAndLease<typeof Recommendations.proposeRecommendation>;
  /** Rebuilds all of one IST day's intraday buckets for this org. Idempotent. Throws `DayLockBusy` or `DayTimeout`. */
  readonly rebuildIntradayDay: (date: string, budget: DayLockBudget) => ReturnType<typeof Facts.rebuildIntradayDay>;
  /** Deletes this org's intraday facts older than the retention for `today`; rows removed. */
  readonly purgeIntradayFacts: (today: string) => Promise<number>;
};
