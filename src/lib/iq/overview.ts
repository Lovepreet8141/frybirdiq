import { addDays } from "@/lib/dates";
import { type Paise, ZERO, formatINR, ratioBps } from "@/lib/money";

/**
 * FRYBIRD IQ Overview — the pure rules.
 *
 * Everything on the Overview that is a *decision* rather than a *query*
 * lives here so it can be tested without a database: which comparisons the
 * data can honestly support, how a tile reads its number, and which
 * attention cards fire. Nothing here invents a number; every input is a
 * figure the repository already measured.
 */

/* ------------------------------------------------------------------ */
/* Ranges and comparisons                                              */
/* ------------------------------------------------------------------ */

export type OverviewRange = "today" | "yesterday" | "7d" | "30d";
export const OVERVIEW_RANGES: readonly { key: OverviewRange; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "yesterday", label: "Yesterday" },
  { key: "7d", label: "7 days" },
  { key: "30d", label: "30 days" },
];

export function isOverviewRange(value: string | undefined): value is OverviewRange {
  return OVERVIEW_RANGES.some((range) => range.key === value);
}

export function isMultiDay(range: OverviewRange): boolean {
  return range === "7d" || range === "30d";
}

export function rangeDays(range: OverviewRange): number {
  return range === "7d" ? 7 : range === "30d" ? 30 : 1;
}

export type CompareKey = "lw" | "yd" | "avg4" | "prev" | "ly";

export interface CompareOption {
  readonly key: CompareKey;
  readonly label: string;
  readonly note: string;
  readonly available: boolean;
  /** Why it is unavailable, in one sentence. */
  readonly reason?: string;
}

/** Where the opening date came from, so the screen can say so. */
export interface OpeningDate {
  readonly date: string | null;
  readonly source: "settings" | "first-order" | "unknown";
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

function longDate(date: string): string {
  return new Date(`${date}T12:00:00+05:30`).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", weekday: "short", day: "numeric", month: "short" });
}

function shortDate(date: string): string {
  return new Date(`${date}T12:00:00+05:30`).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric" });
}

/**
 * The comparisons a range can offer, and why the others cannot be chosen.
 *
 * Availability is a matter of trading history: a same-day-last-week needs a
 * week of it, a 4-week average four weeks, last year a year. The opening
 * date decides; when it is unknown, only the comparison that needs the
 * least history is offered.
 */
export function compareOptions(range: OverviewRange, opening: OpeningDate, today: string): readonly CompareOption[] {
  const history = opening.date ? daysBetween(opening.date, today) : 0;
  const openedNote = opening.date ? `Store opened ${shortDate(opening.date)}${opening.source === "first-order" ? " (first order)" : ""}` : "Opening date not set";
  const needs = (days: number, what: string): { available: boolean; reason?: string } =>
    history >= days ? { available: true } : { available: false, reason: opening.date ? `Needs ${what} of history · ${openedNote}` : `${openedNote} — set it under Restaurant settings` };
  const lastYear = opening.date ? `Available ${shortDate(addDays(opening.date, 365))}` : "Opening date not set";

  if (isMultiDay(range)) {
    const days = rangeDays(range);
    return [
      { key: "prev", label: "Previous period", note: `The ${days} days before this range`, ...needs(days * 2, `${days * 2} days`) },
      range === "7d"
        ? { key: "avg4", label: "4-week average", note: "Same span, averaged over the last 4 weeks", ...needs(35, "5 weeks") }
        : { key: "avg4", label: "4-week average", note: "Same span, averaged over the last 4 weeks", available: false, reason: "Not meaningful for a 30-day range" },
      { key: "ly", label: "Same period last year", note: openedNote, available: false, reason: lastYear },
    ];
  }

  const isToday = range === "today";
  const day = isToday ? today : addDays(today, -1);
  return [
    { key: "lw", label: "Same day last week", note: isToday ? `${longDate(addDays(day, -7))}, to the same hour` : longDate(addDays(day, -7)), ...needs(7, "a week") },
    { key: "yd", label: isToday ? "Yesterday" : "Day before", note: "Different weekday — use with care", ...needs(1, "a day") },
    { key: "avg4", label: "4-week average", note: "Same weekday, last 4 weeks", ...needs(28, "4 weeks") },
    { key: "ly", label: isToday ? "Same day last year" : "Same day last year", note: openedNote, available: false, reason: lastYear },
  ];
}

/** The comparison to use: the requested one if it is offered, else the first available. */
export function resolveCompare(options: readonly CompareOption[], requested: string | undefined): CompareOption | null {
  const wanted = options.find((option) => option.key === requested && option.available);
  return wanted ?? options.find((option) => option.available) ?? null;
}

/* ------------------------------------------------------------------ */
/* Deltas                                                              */
/* ------------------------------------------------------------------ */

/** Change in basis points, or null when there is nothing to compare against — a rise from zero is not a percentage. */
export function deltaBps(current: bigint | number, previous: bigint | number): number | null {
  const now = typeof current === "bigint" ? current : BigInt(Math.round(current));
  const before = typeof previous === "bigint" ? previous : BigInt(Math.round(previous));
  if (before === 0n) return null;
  return ratioBps((now - before) as Paise, before as Paise);
}

/* ------------------------------------------------------------------ */
/* Right now                                                           */
/* ------------------------------------------------------------------ */

/** "9m 40s", "45s", "—" for nothing. */
export function formatDuration(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms) || ms < 0) return "—";
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes === 0 ? `${seconds}s` : `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}

export function onTimeRate(hits: number, total: number): { value: string; sub: string } {
  if (total === 0) return { value: "—", sub: "No promised orders ready yet" };
  const bps = Math.round((hits / total) * 10_000);
  return { value: `${(bps / 100).toFixed(1)}%`, sub: `${hits} of ${total} inside promise` };
}

export function kitchenLoad(openTickets: number, capacity: number): { value: string; sub: string; over: boolean } {
  if (capacity <= 0) return { value: "—", sub: `${openTickets} tickets · set a kitchen capacity`, over: false };
  const pct = Math.round((openTickets / capacity) * 100);
  return { value: `${pct}%`, sub: `${openTickets} ${openTickets === 1 ? "ticket" : "tickets"} · capacity ${capacity}`, over: pct > 100 };
}

/* ------------------------------------------------------------------ */
/* Needs attention                                                     */
/* ------------------------------------------------------------------ */

export type AlertLevel = "NOW" | "TODAY" | "THIS WEEK" | "SETUP";

export interface AlertCard {
  readonly id: string;
  readonly level: AlertLevel;
  readonly title: string;
  readonly evidence: string;
  readonly causeLabel: string;
  readonly cause: string;
  readonly action: string;
  readonly primary: { readonly label: string; readonly href: string };
  readonly secondary: { readonly label: string; readonly href: string };
}

export interface AttentionInput {
  readonly late: { readonly count: number; readonly oldestLateMinutes: number; readonly inKitchen: number };
  readonly prep: { readonly averageMs: number | null; readonly count: number };
  readonly pendingCash: { readonly count: number; readonly total: Paise; readonly oldestMinutes: number };
  readonly unsold: readonly { readonly name: string; readonly days: number | null; readonly isHighestPriced: boolean }[];
  /** Days the shop has been trading. A never-sold item is only "not selling" once there have been 7 days to sell it. */
  readonly daysOfHistory: number;
  readonly costs: { readonly directRecorded: boolean; readonly operatingRecorded: boolean; readonly operatingThisMonth: Paise; readonly costLinesRecorded: number; readonly costLinesTotal: number };
}

const UNSOLD_DAYS = 7;

function ago(minutes: number): string {
  if (minutes < 60) return `${minutes} min ago`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h}h ago` : `${h}h ${m}m ago`;
}

/**
 * The attention cards, rule by rule. A card exists only because a measured
 * number crossed a line; its cause names the other numbers on this page
 * that explain it, and nothing more. Order: what needs a hand now first.
 */
export function attentionCards(input: AttentionInput): readonly AlertCard[] {
  const cards: AlertCard[] = [];

  if (input.late.count > 0) {
    const prep = input.prep.averageMs !== null ? `Prep time in the last hour is ${formatDuration(input.prep.averageMs)} across ${input.prep.count} ${input.prep.count === 1 ? "order" : "orders"}` : "No order has gone accept → ready in the last hour";
    cards.push({
      id: "late",
      level: "NOW",
      title: `${input.late.count} ${input.late.count === 1 ? "order is" : "orders are"} running late`,
      evidence: `Oldest ${input.late.oldestLateMinutes} min past its promise · ${input.late.inKitchen} ${input.late.inKitchen === 1 ? "ticket" : "tickets"} open in the kitchen`,
      causeLabel: "What we can see",
      cause: `${prep}, with ${input.late.inKitchen} ${input.late.inKitchen === 1 ? "ticket" : "tickets"} open.`,
      action: "Review the kitchen queue and clear the oldest ticket first. If prep time stays high, hold new online orders until it recovers.",
      primary: { label: "Open kitchen queue", href: "/app/kds" },
      secondary: { label: "View late orders", href: "/app/orders" },
    });
  }

  if (input.pendingCash.count > 0) {
    cards.push({
      id: "cash",
      level: "TODAY",
      title: `${formatINR(input.pendingCash.total, "whole")} in cash orders is unsettled`,
      evidence: `${input.pendingCash.count} ${input.pendingCash.count === 1 ? "order" : "orders"} out with a rider or waiting at the counter · oldest placed ${ago(input.pendingCash.oldestMinutes)}`,
      causeLabel: "Likely cause",
      cause: "Riders have not handed cash to the till yet, or a collection was handed over without taking payment.",
      action: "Take the cash on each order before the shift changes, so today's revenue is paid, not just recorded.",
      primary: { label: "Open payments", href: "/app/finance" },
      secondary: { label: "View orders", href: "/app/orders" },
    });
  }

  const stale = input.unsold.filter((item) => (item.days === null ? input.daysOfHistory >= UNSOLD_DAYS : item.days >= UNSOLD_DAYS));
  if (stale.length > 0) {
    const named = stale.slice(0, 2).map((item) => `${item.name} · ${item.days === null ? "never sold" : `${item.days} days`}`).join(" · ");
    const pricey = stale.find((item) => item.isHighestPriced);
    cards.push({
      id: "unsold",
      level: "THIS WEEK",
      title: `${stale.length} menu ${stale.length === 1 ? "item has" : "items have"} not sold in ${UNSOLD_DAYS}+ days`,
      evidence: `${named}${stale.length > 2 ? ` · +${stale.length - 2} more` : ""} · inventory not connected`,
      causeLabel: "What we know",
      cause: pricey ? `${pricey.name} is the highest-priced item on the menu. Nothing here says why the others are not moving — sales only, no stock or promotion data yet.` : "Sales only — no stock, promotion or placement data to explain the gap yet.",
      action: "Check each item is still reachable on the menu and in combos. Try a promotion for a week, then delist what still does not move.",
      primary: { label: "Review menu", href: "/app/iq/menu/products" },
      secondary: { label: "View promotions", href: "/app/customers/promotions" },
    });
  }

  if (!input.costs.directRecorded) {
    cards.push({
      id: "costs",
      level: "SETUP",
      title: "Profit cannot be calculated yet",
      evidence: `Food, packaging and labour costs are not recorded · ${input.costs.costLinesRecorded} of ${input.costs.costLinesTotal} cost lines present`,
      causeLabel: "Impact",
      cause: input.costs.operatingRecorded
        ? `Gross profit, food cost %, labour %, prime cost and net profit all show — until these are entered. Revenue and operating expenses (${formatINR(input.costs.operatingThisMonth, "whole")} this month) are already recorded.`
        : "Gross profit, food cost %, labour %, prime cost and net profit all show — until these are entered. Revenue is already accurate.",
      action: "Start by recording what you buy for food and packaging — that alone unlocks food cost %. Recipe costs unlock item margins.",
      primary: { label: "Record an expense", href: "/app/iq/expenses/new" },
      secondary: { label: "Ingredients", href: "/app/inventory" },
    });
  }

  return cards;
}

export function alertSummary(cards: readonly AlertCard[]): string {
  if (cards.length === 0) return "Nothing needs attention.";
  const now = cards.filter((card) => card.level === "NOW" || card.level === "TODAY").length;
  const later = cards.length - now;
  const parts: string[] = [];
  if (now > 0) parts.push(`${now} need${now === 1 ? "s" : ""} action now`);
  if (later > 0) parts.push(`${later} this week`);
  return parts.join(" · ");
}

/* ------------------------------------------------------------------ */
/* KPI row                                                             */
/* ------------------------------------------------------------------ */

export function excludedNote(excluded: { readonly cancelled: number; readonly refunded: number }): string {
  const parts: string[] = [];
  if (excluded.cancelled > 0) parts.push(`${excluded.cancelled} cancelled`);
  if (excluded.refunded > 0) parts.push(`${excluded.refunded} refunded`);
  return parts.length === 0 ? "Excludes nothing — no cancelled or refunded orders" : `Excludes ${parts.join(" and ")} ${excluded.cancelled + excluded.refunded === 1 ? "order" : "orders"}`;
}

export interface CostInputs {
  readonly purchases: number;
  readonly stockCounts: number;
  readonly waste: number;
  readonly recipeCosts: number;
  readonly packaging: number;
}

export function costInputsConnected(inputs: CostInputs): { connected: number; total: number } {
  const total = 5;
  const connected = [inputs.purchases, inputs.stockCounts, inputs.waste, inputs.recipeCosts, inputs.packaging].filter((count) => count > 0).length;
  return { connected, total };
}

/** Average order value in paise; zero orders has no average, not a divide-by-zero. */
export function averageOrder(revenue: Paise, orders: number): Paise {
  return orders === 0 ? ZERO : ((revenue / BigInt(orders)) as Paise);
}
