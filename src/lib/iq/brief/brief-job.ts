/**
 * iq-brief-daily — the job body that stores the brief's FACTs for one IST day.
 *
 * IQ-2 DESIGN.md §4 and R2.1/R2.8/R2.10. The brief itself is never stored:
 * `compose.ts` builds it at read time. This job stores what the brief's
 * "Yesterday" section cites, as FACT insights for D-1:
 * Net sales (excl. GST), Orders, Average order (excl. GST), Food cost –
 * recipe estimate, Collected after refunds (incl. GST), and month-to-date
 * net sales beside the same days last month.
 *
 * Pure orchestration over ports, like `detect-job.ts`: no database, no
 * repository import. The adapter in `src/lib/jobs/jobs/brief.ts`
 * (AUTOMATION-ARCHITECT) binds `readFigures` to the facts and trust readers,
 * which mint the Observed figures — this module never makes one from a
 * number.
 *
 * 1. Refuses to run unless facts for the day are final (UPSTREAM_NOT_READY),
 *    so the brief never cites a half-built figure.
 * 2. Reads each figure with its trust for the periods `briefPeriods` names.
 * 3. In one fenced chunk, writes one FACT per figure present. A missing
 *    figure is counted and not written; the brief drops its line.
 */
import { addDays } from "@/lib/dates";
import { UpstreamNotReady, istDayStart, istTimestamp } from "@/lib/iq/detect/detect-job";
import { computeContentHash, trustRefFor, type FigureTrust, type InsightOf, type Observed, type Unit } from "@/lib/iq/engine";
import { clampSpanToLaunch, isPreLaunch } from "@/lib/iq/launch-window";
import type { JobRunResult } from "@/lib/jobs/context";

import { BRIEF_JOB_NAME, BRIEF_PRODUCER, BRIEF_SOURCE_QUERY, briefFactKey, briefFactTemplateId, type BriefWindow } from "./keys";
import { BRIEF_DAY_METRICS, type BriefDayMetric } from "./templates";

export { UpstreamNotReady };

/** Inclusive IST business dates. */
export type DateSpan = { readonly from: string; readonly to: string };

export type BriefPeriods = {
  readonly day: DateSpan;
  /** The 1st of the day's month to the day. */
  readonly monthToDate: DateSpan;
  /** The 1st of the previous month to the same day number, clamped to that month's length. */
  readonly sameDaysLastMonth: DateSpan & { readonly clamped: boolean };
};

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * R2.10: "Month to date net sales and the same days last month (1..d, clamped to that month's length)".
 *
 * `openedOn` (`analytics-start-date`) clamps `monthToDate` and `sameDaysLastMonth` so neither ever starts
 * before the org's Opening date — a month that opened mid-way through, or a "same days last month" span
 * that falls entirely before launch, never has pre-launch test data folded into month-to-date net sales.
 * `null` (the default) applies no clamp, unchanged from before this existed.
 */
export function briefPeriods(date: string, openedOn: string | null = null): BriefPeriods {
  const [year, month, day] = date.split("-").map(Number) as [number, number, number];
  const prevYear = month === 1 ? year - 1 : year;
  const prevMonth = month === 1 ? 12 : month - 1;
  const prevLength = new Date(Date.UTC(prevYear, prevMonth, 0)).getUTCDate();
  const prevDay = Math.min(day, prevLength);
  return {
    day: { from: date, to: date },
    monthToDate: clampSpanToLaunch({ from: `${year}-${pad(month)}-01`, to: date }, openedOn, false),
    sameDaysLastMonth: clampSpanToLaunch({ from: `${prevYear}-${pad(prevMonth)}-01`, to: `${prevYear}-${pad(prevMonth)}-${pad(prevDay)}`, clamped: prevDay < day }, openedOn, false),
  };
}

/** One figure the reader found, with the trust of the metric it rests on. */
export type BriefFigure = { readonly value: Observed; readonly trust: FigureTrust };

export type BriefFiguresRead = {
  /** The day's figures; a figure with no value that day (no orders → no average) is absent. */
  readonly day: Readonly<Partial<Record<BriefDayMetric, BriefFigure>>>;
  /** Σ revenue_net over `monthToDate`, trust over the same span; null when no day in it has facts. */
  readonly monthToDate: BriefFigure | null;
  /** Σ revenue_net over `sameDaysLastMonth`; null when no day in it has facts. */
  readonly sameDaysLastMonth: BriefFigure | null;
};

export const BRIEF_FIGURE_UNITS: Readonly<Record<BriefDayMetric, Unit>> = {
  revenue_net: "paise",
  orders_paid: "count",
  aov_net: "paise",
  food_cost_pct_theoretical: "bps",
  net_collected: "paise",
};

export type BriefWriter = {
  readonly writeInsight: (insight: InsightOf<"FACT">, options: { readonly asOf: string }) => Promise<{ readonly outcome: string }>;
};

export type BriefJobPorts = {
  readonly orgId: string;
  readonly runId: string;
  readonly attempt: number;
  readonly codeVersion: string;
  /** The IST business day the brief covers (the run's D-1). */
  readonly date: string;
  /** The org's Opening date, or null if not set (`analytics-start-date`) — clamps monthToDate/sameDaysLastMonth so the brief never cites pre-launch net sales as if they were real trading days. */
  readonly openedOn: string | null;
  /** True when daily facts for `date` are final (RELIABILITY C4). */
  readonly factsReady: (date: string) => Promise<boolean>;
  readonly readFigures: (periods: BriefPeriods) => Promise<BriefFiguresRead>;
  readonly newId: () => string;
  readonly now: () => Date;
  readonly commit: <T>(write: (writer: BriefWriter) => Promise<T>) => Promise<T>;
};

function spanPeriod(span: DateSpan) {
  return { start: istDayStart(span.from), end: istDayStart(addDays(span.to, 1)) };
}

export async function factInsight(
  metricId: string,
  window: BriefWindow,
  span: DateSpan,
  figure: BriefFigure,
  meta: Pick<BriefJobPorts, "orgId" | "runId" | "attempt" | "codeVersion" | "newId" | "date"> & { readonly createdAt: string },
): Promise<InsightOf<"FACT">> {
  const period = spanPeriod(span);
  const evidence = [{ kind: "metric" as const, metricId, period }];
  const payload: InsightOf<"FACT">["payload"] = { metricId, value: figure.value, sourceQueryId: BRIEF_SOURCE_QUERY };
  return {
    id: meta.newId(),
    orgId: meta.orgId,
    locationId: null,
    schemaVersion: 1,
    producer: BRIEF_PRODUCER,
    subject: { kind: "METRIC", ref: metricId },
    period,
    dedupeKey: briefFactKey(metricId, meta.date, window),
    evidence,
    trust: trustRefFor(metricId, figure.trust),
    copy: { templateId: briefFactTemplateId(metricId, window), slots: { value: "value" } },
    status: "ACTIVE",
    producedBy: { job: BRIEF_JOB_NAME, runId: meta.runId, attempt: meta.attempt, codeVersion: meta.codeVersion },
    contentHash: await computeContentHash({ payload, evidence }),
    supersedes: null,
    createdAt: meta.createdAt,
    expiresAt: null,
    claimType: "FACT",
    payload,
  };
}

function checkUnit(metricId: string, figure: BriefFigure, unit: Unit): void {
  if (figure.value.unit !== unit) throw new TypeError(`brief: ${metricId} must be ${unit}, got ${figure.value.unit}`);
}

export async function runBriefDaily(ports: BriefJobPorts): Promise<JobRunResult> {
  if (!(await ports.factsReady(ports.date))) throw new UpstreamNotReady(ports.date);

  const periods = briefPeriods(ports.date, ports.openedOn);
  const read = await ports.readFigures(periods);
  const createdAt = istTimestamp(ports.now());
  const meta = { ...ports, createdAt };
  const summary: Record<string, number> = { facts_planned: 0, figures_missing: 0 };

  // `analytics-start-date`: the day itself, unlike monthToDate/sameDaysLastMonth, is never clamped by
  // briefPeriods (its span is always exactly `date`, so clamping it would invert `from`/`to` rather than
  // shrink them — a shape the read side does not expect). Guarded here instead: a pre-launch day plans no
  // day-window facts at all, so the brief never stores "Yesterday: net sales / orders / …" for a test day
  // as if it were a real one (found in review — the day window was the one span this card missed).
  const dayIsPreLaunch = isPreLaunch(ports.date, ports.openedOn);
  if (dayIsPreLaunch) summary.pre_launch_day = 1;

  const planned: { metricId: string; window: BriefWindow; span: DateSpan; figure: BriefFigure | null | undefined; unit: Unit }[] = [
    ...(dayIsPreLaunch ? [] : BRIEF_DAY_METRICS.map((metricId) => ({ metricId, window: "day" as const, span: periods.day, figure: read.day[metricId], unit: BRIEF_FIGURE_UNITS[metricId] }))),
    { metricId: "revenue_net", window: "month_to_date", span: periods.monthToDate, figure: read.monthToDate, unit: "paise" },
    { metricId: "revenue_net", window: "same_days_last_month", span: periods.sameDaysLastMonth, figure: read.sameDaysLastMonth, unit: "paise" },
  ];

  const insights: InsightOf<"FACT">[] = [];
  for (const item of planned) {
    summary.facts_planned! += 1;
    if (!item.figure) {
      summary.figures_missing! += 1;
      const key = item.window === "day" ? `figure_missing:${item.metricId}` : `figure_missing:${item.metricId}:${item.window}`;
      summary[key] = 1;
      continue;
    }
    checkUnit(item.metricId, item.figure, item.unit);
    insights.push(await factInsight(item.metricId, item.window, item.span, item.figure, meta));
  }

  // Every fact is as of the end of the day it describes (month-to-date ends on the same day).
  const asOf = istDayStart(addDays(ports.date, 1));
  const writes = await ports.commit(async (writer) => {
    const outcomes: string[] = [];
    for (const insight of insights) outcomes.push((await writer.writeInsight(insight, { asOf })).outcome);
    return outcomes;
  });

  for (const outcome of writes) summary[`insight_${outcome.toLowerCase()}`] = (summary[`insight_${outcome.toLowerCase()}`] ?? 0) + 1;
  return { status: "COMPLETE", rowsWritten: writes.filter((o) => o !== "NOOP" && o !== "STALE_WRITE").length, summary };
}
