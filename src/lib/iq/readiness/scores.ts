/**
 * IQ READINESS — how much of the shop's own record-keeping the numbers on the
 * dashboard can lean on. Five scores, each a plain percent of stored rows with
 * a trend against the week before, one overall percent, and the single most
 * useful action for today.
 *
 * Pure: counts in, words and percents out. Every figure is a fact counted from
 * stored rows by `getReadiness`; nothing here forecasts, estimates or writes.
 * A score with nothing to measure is "no data", never 0% and never 100%, and it
 * counts as limited (the honest reading of "nobody has checked").
 */

export const READINESS_IDS = ["closedSameDay", "cashRecorded", "recipeCoverage", "stockCount", "customerAttached"] as const;
export type ReadinessId = (typeof READINESS_IDS)[number];

/** An insight that depends on a score under this is marked limited. */
export const LIMITED_BELOW_PERCENT = 80;
/** The stock count turns red when the last one is older than this many days. */
export const STOCK_COUNT_RED_DAYS = 7;

export const READINESS_LABELS: Readonly<Record<ReadinessId, string>> = {
  closedSameDay: "Orders closed the same day",
  cashRecorded: "Cash recorded for completed cash orders",
  recipeCoverage: "Top-20 items with a recipe",
  stockCount: "Stock counted in the last 7 days",
  customerAttached: "Orders with a customer attached",
};

/** What each score counts, in one plain sentence (shown under the figure). */
export const READINESS_DEFINITIONS: Readonly<Record<ReadinessId, string>> = {
  closedSameDay: "Orders from the last 7 finished days that were completed or cancelled before that day ended.",
  cashRecorded: "Completed orders paid by cash, from the last 7 finished days, that have the cash recorded as received.",
  recipeCoverage: "Of the 20 items sold most in the last 30 days, how many have a costed recipe.",
  stockCount: "Of the ingredients kept in stock, how many had a physical count that changed the balance in the last 7 days. A count that matches the balance leaves no record.",
  customerAttached: "Orders from the last 7 finished days with a customer on them.",
};

/** Counts for one score: this period, and the same measure a week earlier. */
export interface RawScore {
  readonly numerator: number;
  readonly denominator: number;
  readonly previousNumerator: number;
  readonly previousDenominator: number;
}

export interface ReadinessRaw {
  readonly closedSameDay: RawScore;
  readonly cashRecorded: RawScore;
  readonly recipeCoverage: RawScore & { readonly firstMissingItem: string | null };
  readonly stockCount: RawScore & { readonly daysSinceLastCount: number | null };
  readonly customerAttached: RawScore;
}

export type ScoreState = "ok" | "limited" | "nodata";

export interface Score {
  readonly id: ReadinessId;
  readonly label: string;
  readonly definition: string;
  /** Whole percent, or null when nothing could be measured. */
  readonly percent: number | null;
  readonly numerator: number;
  readonly denominator: number;
  /** Points up or down against the week before; null when either week had nothing to measure. */
  readonly trendPoints: number | null;
  readonly state: ScoreState;
  /** Stock count only: days since the last count, and whether that is red. */
  readonly daysSinceLastCount?: number | null;
  readonly red?: boolean;
}

export interface ReadinessAction {
  readonly scoreId: ReadinessId;
  readonly text: string;
  readonly href: string;
}

export interface Readiness {
  readonly scores: readonly Score[];
  /** Mean of the scores that had data, rounded; null when none did. */
  readonly overallPercent: number | null;
  /** How many of the five scores the overall rests on. */
  readonly basedOn: number;
  readonly action: ReadinessAction | null;
}

export function percentOf(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null;
  return Math.round((numerator * 100) / denominator);
}

function stateOf(percent: number | null): ScoreState {
  if (percent === null) return "nodata";
  return percent < LIMITED_BELOW_PERCENT ? "limited" : "ok";
}

function score(id: ReadinessId, raw: RawScore): Score {
  const percent = percentOf(raw.numerator, raw.denominator);
  const previous = percentOf(raw.previousNumerator, raw.previousDenominator);
  return {
    id,
    label: READINESS_LABELS[id],
    definition: READINESS_DEFINITIONS[id],
    percent,
    numerator: raw.numerator,
    denominator: raw.denominator,
    trendPoints: percent !== null && previous !== null ? percent - previous : null,
    state: stateOf(percent),
  };
}

const ACTIONS: Readonly<Record<ReadinessId, (raw: ReadinessRaw) => ReadinessAction>> = {
  closedSameDay: (raw) => {
    const open = raw.closedSameDay.denominator - raw.closedSameDay.numerator;
    return { scoreId: "closedSameDay", text: `${open} of ${raw.closedSameDay.denominator} orders in the last 7 days were not closed the same day. Open Orders and finish or cancel the old ones.`, href: "/app/orders" };
  },
  cashRecorded: (raw) => {
    const missing = raw.cashRecorded.denominator - raw.cashRecorded.numerator;
    return { scoreId: "cashRecorded", text: `${missing} completed cash ${missing === 1 ? "order has" : "orders have"} no cash recorded. Record it against the person who took it.`, href: "/app/finance" };
  },
  recipeCoverage: (raw) => {
    const missing = raw.recipeCoverage.denominator - raw.recipeCoverage.numerator;
    const start = raw.recipeCoverage.firstMissingItem ? `, starting with ${raw.recipeCoverage.firstMissingItem}` : "";
    return { scoreId: "recipeCoverage", text: `${missing} of your top ${raw.recipeCoverage.denominator} items ${missing === 1 ? "has" : "have"} no costed recipe${start}. Add the ingredients so food cost is real.`, href: "/app/inventory" };
  },
  stockCount: (raw) => {
    const days = raw.stockCount.daysSinceLastCount;
    const when = days === null ? "nothing has been counted yet" : days === 0 ? "the last count was today" : `the last count was ${days} ${days === 1 ? "day" : "days"} ago`;
    return { scoreId: "stockCount", text: `Count stock today: ${when}.`, href: "/app/inventory" };
  },
  customerAttached: (raw) => {
    const missing = raw.customerAttached.denominator - raw.customerAttached.numerator;
    return { scoreId: "customerAttached", text: `${missing} of ${raw.customerAttached.denominator} orders in the last 7 days have no customer on them. Ask for a phone number at the counter.`, href: "/app/pos" };
  },
};

/**
 * The one action: the weakest score that has data. A score with no data ranks
 * below any measured one (fix what is known to be weak first), and only if
 * nothing at all was measured does the action ask for that data. Nothing to do
 * when every measured score is 100%.
 */
function pickAction(raw: ReadinessRaw, scores: readonly Score[]): ReadinessAction | null {
  const measured = scores.filter((s) => s.percent !== null && s.percent < 100);
  const weakest = [...measured].sort((a, b) => (a.percent ?? 0) - (b.percent ?? 0) || READINESS_IDS.indexOf(a.id) - READINESS_IDS.indexOf(b.id))[0];
  if (weakest) return ACTIONS[weakest.id](raw);
  return null;
}

export function buildReadiness(raw: ReadinessRaw): Readiness {
  const base = READINESS_IDS.map((id) => score(id, raw[id]));
  const scores = base.map((s): Score => {
    if (s.id !== "stockCount") return s;
    const days = raw.stockCount.daysSinceLastCount;
    return { ...s, daysSinceLastCount: days, red: days === null || days > STOCK_COUNT_RED_DAYS };
  });
  const measured = scores.filter((s): s is Score & { percent: number } => s.percent !== null);
  const overallPercent = measured.length === 0 ? null : Math.round(measured.reduce((sum, s) => sum + s.percent, 0) / measured.length);
  return { scores, overallPercent, basedOn: measured.length, action: pickAction(raw, scores) };
}

/* ------------------------------------------------- limited badges on cards */

/** Which scores each dashboard card's figures rest on. */
export const CARD_DEPENDENCIES = {
  paymentMethods: ["cashRecorded", "closedSameDay"],
  topProducts: ["closedSameDay"],
  attention: ["closedSameDay"],
  channels: ["closedSameDay"],
  netProfit: ["recipeCoverage", "stockCount"],
} as const satisfies Readonly<Record<string, readonly ReadinessId[]>>;
export type ReadinessCard = keyof typeof CARD_DEPENDENCIES;

/**
 * The scores that make a card limited: each dependency that is under 80% or has
 * no data. Empty means the card stands as it is. The words name what is weak so
 * the badge can say why.
 */
export function limitedReasons(readiness: Readiness, card: ReadinessCard): readonly string[] {
  return CARD_DEPENDENCIES[card].flatMap((id) => {
    const found = readiness.scores.find((s) => s.id === id);
    if (!found || found.state === "ok") return [];
    return [found.percent === null ? `${found.label}: no data yet` : `${found.label}: ${found.percent}%`];
  });
}

/** The line the daily brief carries: the overall percent and the one action. */
export function readinessBriefLine(readiness: Readiness): string {
  if (readiness.overallPercent === null) return "IQ readiness: not enough recorded data to score yet.";
  const head = `IQ readiness ${readiness.overallPercent}% (from ${readiness.basedOn} of 5 scores).`;
  return readiness.action ? `${head} Today's action: ${readiness.action.text}` : `${head} No action needed today.`;
}
