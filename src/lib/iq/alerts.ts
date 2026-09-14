/**
 * The Alerts screen's pure helpers: assembling `attentionCards`' input
 * from the measurements the repositories return, and grouping the cards
 * by urgency. The rules themselves live in `overview.ts`; this file only
 * feeds and sorts them, so the Alerts screen and the Overview panel can
 * never disagree about what needs attention.
 */

import type { Paise } from "@/lib/money";
import { type AlertCard, type AlertLevel, type AttentionInput } from "./overview";

export const ALERT_LEVELS: readonly AlertLevel[] = ["NOW", "TODAY", "THIS WEEK", "SETUP"];

export const LEVEL_COPY: Readonly<Record<AlertLevel, { readonly title: string; readonly note: string }>> = {
  NOW: { title: "Now", note: "Customers are waiting on these" },
  TODAY: { title: "Today", note: "Before the shift changes" },
  "THIS WEEK": { title: "This week", note: "Worth a decision, not a sprint" },
  SETUP: { title: "Setup", note: "Inputs that would make a figure real" },
};

const DAY_MS = 86_400_000;

/** Whole days the shop has been trading; 0 when the opening date is unknown or in the future. */
export function daysOfHistory(openingDate: string | null, today: string): number {
  if (!openingDate) return 0;
  return Math.max(0, Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${openingDate}T00:00:00Z`)) / DAY_MS));
}

export interface AttentionSources {
  readonly late: AttentionInput["late"];
  readonly prep: AttentionInput["prep"];
  readonly pendingCash: AttentionInput["pendingCash"];
  readonly unsold: AttentionInput["unsold"];
  readonly openingDate: string | null;
  readonly today: string;
  /** This month's recorded direct and fixed cost totals, and whether any week in the food-cost series had a direct cost. */
  readonly directTotal: Paise;
  readonly fixedTotal: Paise;
  readonly anyWeeklyDirectCost: boolean;
}

/** The same assembly the Overview does, in one place. Four cost lines — food, packaging, labour, operating — of which today only "direct" and "operating" can be recorded. */
export function attentionInput(sources: AttentionSources): AttentionInput {
  const directRecorded = sources.anyWeeklyDirectCost || sources.directTotal > 0n;
  const operatingRecorded = sources.fixedTotal > 0n;
  return {
    late: sources.late,
    prep: sources.prep,
    pendingCash: sources.pendingCash,
    unsold: sources.unsold,
    daysOfHistory: daysOfHistory(sources.openingDate, sources.today),
    costs: {
      directRecorded,
      operatingRecorded,
      operatingThisMonth: sources.fixedTotal,
      costLinesRecorded: [directRecorded, operatingRecorded].filter(Boolean).length,
      costLinesTotal: 4,
    },
  };
}

export interface AlertGroup {
  readonly level: AlertLevel;
  readonly cards: readonly AlertCard[];
}

/** Cards by level in urgency order; levels with nothing in them are omitted. */
export function groupAlerts(cards: readonly AlertCard[]): readonly AlertGroup[] {
  return ALERT_LEVELS.map((level) => ({ level, cards: cards.filter((card) => card.level === level) })).filter((group) => group.cards.length > 0);
}

export function urgentCount(cards: readonly AlertCard[]): number {
  return cards.filter((card) => card.level === "NOW" || card.level === "TODAY").length;
}
