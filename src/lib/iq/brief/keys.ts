/**
 * How the brief job names what it stores, so `compose.ts` finds exactly those rows.
 *
 * IQ-2 DESIGN.md §4 and R2.10: the job writes FACT insights for D-1; the brief
 * itself is never stored — it is composed from these and the detections at
 * read time.
 */

export const BRIEF_JOB_NAME = "iq-brief-daily";
export const BRIEF_PRODUCER = "brief.daily";
/** What a brief FACT's `sourceQueryId` names: sums of current-version daily facts. */
export const BRIEF_SOURCE_QUERY = "iq_daily_facts.sum";

/** A FACT for the day itself, or one of the two month-to-date comparison windows. */
export type BriefWindow = "day" | "month_to_date" | "same_days_last_month";

export function briefFactKey(metricId: string, date: string, window: BriefWindow = "day"): string {
  return window === "day" ? `brief:fact:${metricId}:${date}` : `brief:fact:${metricId}:${window}:${date}`;
}

export function briefFactTemplateId(metricId: string, window: BriefWindow = "day"): string {
  return window === "day" ? `brief.fact.${metricId}` : `brief.fact.${metricId}.${window}`;
}
