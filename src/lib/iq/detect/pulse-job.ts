/**
 * iq-service-pulse — the job body for the IQ-2 service pulse (slice S9).
 *
 * hive/reviews/iq-2/DESIGN.md §3 and Revision 2 (R2.1 thin adapter + domain body,
 * R2.4 expire only evaluated keys, R2.8 budgets and inputs); REVIEW-RELIABILITY
 * C8 and U3.
 *
 * Pure orchestration over ports: no database, no repository import. The
 * adapter in `src/lib/jobs/jobs/pulse.ts` (AUTOMATION-ARCHITECT) binds the ports
 * to ctx and adds the registry line (timer :05/:20/:35/:50, light, catch-up 0).
 *
 * One run evaluates the last complete 15-minute bucket:
 * 1. reads the org's opening hours; hours that wrap past midnight are refused
 *    (`hours_wrap_unsupported`), and before opening nothing runs;
 * 2. after closing, expires the day's pulse findings with CLOSING_TIME and stops;
 * 3. requires fresh input (C8/U3): a SUCCEEDED intraday writer run that started
 *    at or after the bucket end. Otherwise `stale_input` — no fire, no expire;
 * 4. reads today and the same weekday's 8 previous weeks, and counts paid orders
 *    for the last 45 minutes straight from orders;
 * 5. in one fenced chunk writes each FIRED finding (as of the bucket end) and
 *    expires only the keys that evaluated CLEAR.
 */
import { businessDate } from "@/lib/dates";
import { computeContentHash, type Evidence, type InsightOf, type Observed } from "@/lib/iq/engine";
import type { JobRunResult } from "@/lib/jobs/context";

import { baselineDates } from "./baseline";
import { istTimestamp } from "./detect-job";
import {
  BUCKET_MINUTES,
  PULSE_RULE_IDS,
  evaluatePulse,
  istAt,
  minuteOfDay,
  pulseDedupeKey,
  type OpeningHours,
  type PulseDay,
  type PulseOutcome,
} from "./pulse";

export const PULSE_JOB_NAME = "iq-service-pulse";
export const PULSE_PRODUCER = "detect.pulse";

export type PulseExpireRequest = { readonly dedupeKey: string; readonly asOf: string; readonly reason: "CLEARED" | "CLOSING_TIME" };

export type PulseWriter = {
  readonly writeInsight: (insight: InsightOf<"DETECTION">, options: { readonly asOf: string }) => Promise<{ readonly outcome: string }>;
  readonly expireInsights: (requests: readonly PulseExpireRequest[]) => Promise<{ readonly expired: number }>;
};

export type PulseJobPorts = {
  readonly orgId: string;
  readonly runId: string;
  readonly attempt: number;
  readonly codeVersion: string;
  readonly now: () => Date;
  readonly readOpeningHours: () => Promise<OpeningHours>;
  /** True when a SUCCEEDED intraday writer run started at or after `bucketEnd` (IST timestamp) — RELIABILITY U3. */
  readonly intradayFreshAt: (bucketEnd: string) => Promise<boolean>;
  /** Intraday facts for these IST dates (built with `pulseDayFrom`); a missing date counts as not computed. */
  readonly readPulseDays: (dates: readonly string[]) => Promise<readonly PulseDay[]>;
  /** Paid orders created in [from, to) (IST timestamps), counted directly from orders (R2.8). */
  readonly countPaidOrders: (from: string, to: string) => Promise<Observed>;
  /** Owner-supplied closure / reduced-hours dates (gated owner input, R2.9); empty unless provided. */
  readonly excludedDates?: readonly string[];
  readonly newId: () => string;
  readonly commit: <T>(write: (writer: PulseWriter) => Promise<T>) => Promise<T>;
};

const BUCKET_MS = BUCKET_MINUTES * 60_000;

/** The last complete bucket before `now`: its IST business date and end minute (15 … 1440). */
export function lastCompleteBucket(now: Date): { readonly date: string; readonly endMinute: number; readonly endInstant: Date } {
  const endInstant = new Date(Math.floor(now.getTime() / BUCKET_MS) * BUCKET_MS);
  const date = businessDate(new Date(endInstant.getTime() - 1));
  const midnight = new Date(`${date}T00:00:00+05:30`).getTime();
  return { date, endMinute: Math.round((endInstant.getTime() - midnight) / 60_000), endInstant };
}

type Fired = Extract<PulseOutcome, { status: "FIRED" }>;

async function pulseInsight(
  outcome: Fired,
  meta: Pick<PulseJobPorts, "orgId" | "runId" | "attempt" | "codeVersion" | "newId"> & { readonly date: string; readonly createdAt: string },
): Promise<InsightOf<"DETECTION">> {
  const period = { start: istAt(meta.date, outcome.window.startMinute), end: istAt(meta.date, outcome.window.endMinute) };
  const evidence: Evidence[] = [{ kind: "metric", metricId: outcome.metricId, period }];
  const oldest = baselineDates(meta.date).at(-1)!;
  evidence.push({ kind: "metric", metricId: outcome.metricId, period: { start: `${oldest}T00:00:00+05:30`, end: `${meta.date}T00:00:00+05:30` } });
  const payload: InsightOf<"DETECTION">["payload"] = {
    ruleId: outcome.ruleId,
    observed: outcome.observed,
    baseline: outcome.baseline,
    deviationBps: outcome.deviationBps,
    severity: outcome.severity,
  };
  return {
    id: meta.newId(),
    orgId: meta.orgId,
    locationId: null,
    schemaVersion: 1,
    producer: PULSE_PRODUCER,
    subject: { kind: "METRIC", ref: outcome.metricId },
    period,
    dedupeKey: outcome.dedupeKey,
    evidence,
    // Intraday facts carry no trust rows; say so rather than imply a score.
    trust: { state: "NOT_MEASURED" },
    copy: { templateId: outcome.ruleId, slots: { observed: "observed", baseline: "baseline.value" } },
    status: "ACTIVE",
    producedBy: { job: PULSE_JOB_NAME, runId: meta.runId, attempt: meta.attempt, codeVersion: meta.codeVersion },
    contentHash: await computeContentHash({ payload, evidence }),
    supersedes: null,
    createdAt: meta.createdAt,
    expiresAt: null,
    claimType: "DETECTION",
    payload,
  };
}

export async function runServicePulse(ports: PulseJobPorts): Promise<JobRunResult> {
  const { date, endMinute } = lastCompleteBucket(ports.now());
  const asOf = istAt(date, endMinute);
  const hours = await ports.readOpeningHours();
  const opening = minuteOfDay(hours.opening);
  const closing = minuteOfDay(hours.closing);

  const done = (summary: Record<string, number>, rowsWritten = 0): JobRunResult => ({ status: "COMPLETE", rowsWritten, summary });
  if (opening === null || closing === null) return done({ hours_invalid: 1 });
  if (closing <= opening) return done({ hours_wrap_unsupported: 1 });
  if (endMinute <= opening) return done({ outside_hours: 1 });

  if (endMinute > closing) {
    const requests = PULSE_RULE_IDS.map((ruleId) => ({ dedupeKey: pulseDedupeKey(ruleId, date), asOf, reason: "CLOSING_TIME" as const }));
    const { expired } = await ports.commit((writer) => writer.expireInsights(requests));
    return done({ outside_hours: 1, insights_expired: expired }, expired);
  }

  if (!(await ports.intradayFreshAt(asOf))) return done({ stale_input: 1 });

  const days = await ports.readPulseDays([date, ...baselineDates(date)]);
  const byDate = new Map(days.map((d) => [d.date, d]));
  const ordersLast45 = await ports.countPaidOrders(istAt(date, Math.max(endMinute - 45, 0)), asOf);

  const evaluation = evaluatePulse({
    date,
    endMinute,
    hours,
    today: byDate.get(date) ?? { date, computed: false, buckets: [] },
    baseline: days.filter((d) => d.date !== date),
    ordersLast45,
    excludedDates: ports.excludedDates ?? [],
  });

  const createdAt = istTimestamp(ports.now());
  const fired = evaluation.outcomes.filter((o): o is Fired => o.status === "FIRED");
  const insights = await Promise.all(fired.map((o) => pulseInsight(o, { ...ports, date, createdAt })));
  const clears: PulseExpireRequest[] = evaluation.outcomes
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
  return done(summary, writes.filter((o) => o !== "NOOP" && o !== "STALE_WRITE").length + expired);
}
