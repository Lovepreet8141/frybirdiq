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
 * two cannot drift apart. Type-only: nothing here reaches a database.
 */
import type * as Facts from "@/lib/repositories/iq-facts";
import type * as Insights from "@/lib/repositories/iq-insights";
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
  readonly listInsights: WithoutOrg<typeof Insights.listInsights>;
  readonly getInsight: WithoutOrg<typeof Insights.getInsight>;
  readonly readFactFigures: WithoutOrg<typeof Insights.readFactFigures>;
  readonly listOpenRecommendations: WithoutOrg<typeof Recommendations.listOpenRecommendations>;
};

export type JobWriteRepos = {
  /** Rebuilds one IST business day's facts for this org, recorded against this run. Idempotent. */
  readonly recomputeDay: (date: string) => ReturnType<typeof Facts.recomputeDay>;
  readonly writeInsight: WithoutTxAndLease<typeof Insights.writeInsight>;
  readonly proposeRecommendation: WithoutTxAndLease<typeof Recommendations.proposeRecommendation>;
};
