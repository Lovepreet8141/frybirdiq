/**
 * iq-detect-daily — the job body for the IQ-2 baseline detectors.
 *
 * hive/reviews/iq-2/DESIGN.md §2 and Revision 2 (R2.1 thin adapter + domain
 * body, R2.4 expire only evaluated keys, R2.8 upstream gate).
 *
 * Pure orchestration over ports: no database, no repository import. The
 * adapter in `src/lib/jobs/jobs/detect.ts` (AUTOMATION-ARCHITECT, S7) binds
 * the ports to `ctx.repos` / `ctx.commit` once S2's `expireInsights` exists.
 *
 * One run evaluates one IST business day (D-1):
 * 1. refuses to run unless the facts run for D is SUCCEEDED (UPSTREAM_NOT_READY);
 * 2. reads D, D-1 and the 8 same-weekday baseline days through the reader;
 * 3. evaluates every rule (`rules.ts`);
 * 4. in one fenced chunk, writes each FIRED detection and expires only the
 *    keys that evaluated CLEAR. NOT_EVALUATED keys are never touched. *
 * TODO(S7, AUTOMATION-ARCHITECT with ANALYTICS-DATA; notes from iq2-s3r-ad, not code here):
 * - `parityFlagged`: facts parity is checked per MONTH (checkFactsParity), there is no per-day
 *   flag. The reader must say how it sets it; flagging every day of a mismatched month would
 *   remove a whole month of baseline points.
 * - UNKNOWN-trust days, including days with no trust rows, stay baseline points (only LOW is
 *   skipped). Fine while trust scoring is wired; add a summary count of such points.
 */
import { addDays } from "@/lib/dates";
import { computeContentHash, trustRefFor, type Evidence, type InsightOf, type Observed } from "@/lib/iq/engine";
import type { JobRunResult } from "@/lib/jobs/context";

import { baselineDates } from "./baseline";
import { evaluateDetectDay, type DetectDay, type RuleOutcome } from "./rules";

export const DETECT_JOB_NAME = "iq-detect-daily";
export const DETECT_PRODUCER = "detect.baseline";

export class UpstreamNotReady extends Error {
  readonly code = "UPSTREAM_NOT_READY";

  constructor(readonly date: string) {
    super("facts for the day are not ready");
    this.name = "UpstreamNotReady";
  }
}

export type ExpireRequest = { readonly dedupeKey: string; readonly asOf: string; readonly reason: "CLEARED" };

/** Writers inside the fenced chunk. */
export type DetectWriter = {
  readonly writeInsight: (insight: InsightOf<"DETECTION">, options: { readonly asOf: string }) => Promise<{ readonly outcome: string }>;
  readonly expireInsights: (requests: readonly ExpireRequest[]) => Promise<{ readonly expired: number }>;
};

export type DetectJobPorts = {
  readonly orgId: string;
  readonly runId: string;
  readonly attempt: number;
  readonly codeVersion: string;
  /** The IST business day to evaluate. */
  readonly date: string;
  /** Owner-supplied closure / reduced-hours dates; empty unless the owner provided them (R2.9). */
  readonly excludedDates?: readonly string[];
  /** True when the facts run for `date` SUCCEEDED (RELIABILITY C4). */
  readonly factsReady: (date: string) => Promise<boolean>;
  readonly readDays: (dates: readonly string[]) => Promise<readonly DetectDay[]>;
  /** The owner's food-cost target for the date's month, from a stored row; null until dec-7. */
  readonly readFoodCostTarget: (date: string) => Promise<Observed | null>;
  readonly newId: () => string;
  readonly now: () => Date;
  readonly commit: <T>(write: (writer: DetectWriter) => Promise<T>) => Promise<T>;
};

/** Start of an IST business day, as the engine's timestamp format. */
export function istDayStart(date: string): string {
  return `${date}T00:00:00+05:30`;
}

/** An instant as an ISO timestamp in IST with an explicit +05:30 offset. */
export function istTimestamp(at: Date): string {
  const shifted = new Date(at.getTime() + 330 * 60_000);
  return `${shifted.toISOString().slice(0, 19)}+05:30`;
}

/** The dates the run reads: the day, the day before (trust drops) and the baseline days. */
export function detectReadDates(date: string): string[] {
  return [date, addDays(date, -1), ...baselineDates(date)];
}

type Fired = Extract<RuleOutcome, { status: "FIRED" }>;

export async function detectionInsight(
  outcome: Fired,
  meta: Pick<DetectJobPorts, "orgId" | "runId" | "attempt" | "codeVersion" | "newId"> & { readonly date: string; readonly createdAt: string },
): Promise<InsightOf<"DETECTION">> {
  const day = { start: istDayStart(meta.date), end: istDayStart(addDays(meta.date, 1)) };
  const evidence: Evidence[] = [{ kind: "metric", metricId: outcome.figure, period: day }];
  const oldest = outcome.pointDates.at(-1);
  if (oldest) evidence.push({ kind: "metric", metricId: outcome.figure, period: { start: istDayStart(oldest), end: day.start } });

  const payload: InsightOf<"DETECTION">["payload"] = {
    ruleId: outcome.ruleId,
    observed: outcome.observed,
    baseline: outcome.baseline,
    deviationBps: outcome.deviationBps,
    severity: outcome.severity,
  };
  const trust = trustRefFor(outcome.figure, outcome.trust, outcome.trustReasons);

  return {
    id: meta.newId(),
    orgId: meta.orgId,
    locationId: null,
    schemaVersion: 1,
    producer: DETECT_PRODUCER,
    subject: { kind: "METRIC", ref: outcome.figure },
    period: day,
    dedupeKey: outcome.dedupeKey,
    evidence,
    trust,
    copy: { templateId: `detect.${outcome.ruleId}`, slots: { observed: "observed", baseline: "baseline.value", deviation: "deviationBps" } },
    status: "ACTIVE",
    producedBy: { job: DETECT_JOB_NAME, runId: meta.runId, attempt: meta.attempt, codeVersion: meta.codeVersion },
    contentHash: await computeContentHash({ payload, evidence }),
    supersedes: null,
    createdAt: meta.createdAt,
    expiresAt: null,
    claimType: "DETECTION",
    payload,
  };
}

export async function runDetectDaily(ports: DetectJobPorts): Promise<JobRunResult> {
  if (!(await ports.factsReady(ports.date))) throw new UpstreamNotReady(ports.date);

  const days = await ports.readDays(detectReadDates(ports.date));
  const foodCostTarget = await ports.readFoodCostTarget(ports.date);
  const evaluation = evaluateDetectDay({ date: ports.date, days, excludedDates: ports.excludedDates ?? [], foodCostTarget });

  const createdAt = istTimestamp(ports.now());
  const fired = evaluation.outcomes.filter((o): o is Fired => o.status === "FIRED");
  const insights = await Promise.all(fired.map((o) => detectionInsight(o, { ...ports, date: ports.date, createdAt })));
  const asOf = istDayStart(addDays(ports.date, 1));
  const clears: ExpireRequest[] = evaluation.outcomes
    .filter((o) => o.status === "CLEAR")
    .map((o) => ({ dedupeKey: o.dedupeKey, asOf, reason: "CLEARED" as const }));

  const summary: Record<string, number> = { ...evaluation.summary };
  const { writes, expired } = await ports.commit(async (writer) => {
    const results: string[] = [];
    for (const insight of insights) results.push((await writer.writeInsight(insight, { asOf })).outcome);
    const expiredResult = clears.length > 0 ? await writer.expireInsights(clears) : { expired: 0 };
    return { writes: results, expired: expiredResult.expired };
  });

  for (const outcome of writes) summary[`insight_${outcome.toLowerCase()}`] = (summary[`insight_${outcome.toLowerCase()}`] ?? 0) + 1;
  summary.insights_expired = expired;
  const rowsWritten = writes.filter((o) => o !== "NOOP").length + expired;
  return { status: "COMPLETE", rowsWritten, summary };
}
