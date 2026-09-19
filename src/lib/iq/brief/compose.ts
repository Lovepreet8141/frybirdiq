/**
 * composeBrief — the owner's daily brief, built at read time from stored insights.
 *
 * IQ-2 DESIGN.md §4 as replaced by R2.10 (BUSINESS-INTELLIGENCE). Pure: the
 * loader passes the day's insights, the check runs and the viewer; nothing
 * here reads a database or a clock.
 *
 * What keeps the brief honest:
 * - **No invented number.** A line is a list of parts. Text parts come from
 *   `templates.ts` and carry no digit; a figure part is the text `present()`
 *   rendered for a cited insight; a date part is the brief's date, the read
 *   time or a cited insight's period; a count part counts lines left out.
 *   The grounding test checks every digit in the rendered brief against that.
 * - **Only FACT and DETECTION.** No forecast, no recommendation, no "today"
 *   line in v1 (B4). Any other claim type in the input is ignored.
 * - **An empty risk list is not an all-clear** unless every check the viewer
 *   may see ran for the day (C1). A missing parity summary reads "not
 *   checked", never zero.
 * - **Payment-ledger findings pass `presentFor`** (R2.2): a viewer without
 *   finance.view gets none of them, no count, and no ledger check lines.
 */
import { businessDate, startOfBusinessDay, endOfBusinessDay } from "@/lib/dates";
import {
  CAPPED_LOW_TRUST,
  presentFor,
  type DetectionPresentation,
  type FactPresentation,
  type Insight,
  type InsightOf,
  type InsightViewer,
  type Presentation,
  type TrustRef,
} from "@/lib/iq/engine";

import { BRIEF_PRODUCER, briefFactKey, type BriefWindow } from "./keys";
import * as T from "./templates";

/* ------------------------------------------------------------------ */
/* Input                                                                */
/* ------------------------------------------------------------------ */

/** A stored insight with the storage facts the brief needs (the repository's StoredInsight satisfies it). */
export type BriefInsight = Insight & {
  readonly statusReason: string | null;
  readonly supersededBy: string | null;
};

/** How a check's run for the brief's date ended. */
export type CheckRun = "SUCCEEDED" | "FAILED" | "NOT_RUN";

export type ParityCheck = { readonly state: "NOT_CHECKED" } | { readonly state: "CHECKED"; readonly matched: boolean };

export type BriefInput = {
  /** The IST business day the brief covers (D-1 of the morning it is read). */
  readonly date: string;
  /** When the brief is composed: insights created later are not in it, and "as of" shows it. */
  readonly readAt: Date;
  readonly viewer: InsightViewer;
  /** The org's insights relevant to `date`, any status. Extra rows are filtered out here. */
  readonly insights: readonly BriefInsight[];
  readonly checks: Readonly<Record<T.CheckName, CheckRun>>;
  readonly parity: ParityCheck;
  /** The detect run's summary for `date` (its `not_evaluated:<ruleId>:<reason>` counts), or null. */
  readonly detectSummary: Readonly<Record<string, number>> | null;
  /**
   * A fix card that explains a finding, for findings that do not say so
   * themselves. Optional: a reconciliation finding already names its card in
   * `copy.templateId` (`recon.explained.<card>`) and `explainingCardOf` reads
   * it, so nothing has to pass this to get pay-4 on a double capture.
   */
  readonly explainedBy?: (insight: BriefInsight) => string | null;
};

/** The facts run summary's parity counts; absent keys mean the check did not run (R2.6). */
export function parityFromSummary(summary: Readonly<Record<string, number>> | null): ParityCheck {
  const checks = summary?.parity_checks;
  if (typeof checks !== "number" || checks <= 0) return { state: "NOT_CHECKED" };
  const mismatches = summary?.parity_mismatches;
  const missing = summary?.parity_missing_days;
  if (typeof mismatches !== "number" || typeof missing !== "number") return { state: "NOT_CHECKED" };
  return { state: "CHECKED", matched: mismatches === 0 && missing === 0 };
}

/* ------------------------------------------------------------------ */
/* Output                                                               */
/* ------------------------------------------------------------------ */

export type DateSource = { readonly from: "brief_date" } | { readonly from: "read_at" } | { readonly from: "insight"; readonly insightId: string; readonly edge: "start" | "end" };

export type BriefPart =
  | { readonly kind: "text"; readonly text: string }
  /** Words chosen from templates.ts (a reason, a direction, a metric name). Never a digit. */
  | { readonly kind: "word"; readonly text: string }
  /** Text `present()` rendered for a cited insight; `unsigned` drops a leading minus the sentence already says. */
  | {
      readonly kind: "figure";
      readonly text: string;
      readonly insightId: string;
      readonly slot: "value" | "observed" | "baseline" | "deviation";
      readonly unsigned: boolean;
    }
  | { readonly kind: "date"; readonly text: string; readonly format: DateFormat; readonly source: DateSource }
  | { readonly kind: "count"; readonly text: string; readonly value: number }
  /** A fix card id such as pay-4, from `explainedBy`. */
  | { readonly kind: "ref"; readonly text: string };

export type DateFormat = "day" | "short_day" | "weekday" | "time" | "last_day";

export type BriefLine = {
  readonly key: string;
  readonly claimType: "FACT" | "DETECTION" | "CHECK" | "NOTE";
  readonly insightIds: readonly string[];
  readonly severity: 1 | 2 | 3 | null;
  readonly parts: readonly BriefPart[];
  readonly text: string;
};

export type BriefSection = { readonly lines: readonly BriefLine[]; readonly more: BriefLine | null };

export type Brief = {
  readonly state: "READY" | "NOT_READY";
  readonly date: string;
  readonly asOf: BriefLine;
  readonly notReady: BriefLine | null;
  readonly yesterday: { readonly heading: BriefLine; readonly lines: readonly BriefLine[] };
  readonly risks: {
    readonly lines: readonly BriefLine[];
    readonly more: BriefLine | null;
    /** Explained by a known fix card; listed below the risks, outside the cap. */
    readonly known: readonly BriefLine[];
    /** Found for the day and cleared since. */
    readonly resolved: readonly BriefLine[];
    readonly empty: BriefLine | null;
  };
  readonly worthKnowing: BriefSection;
  readonly treatWithCare: BriefSection;
  /** Set for a viewer without finance.view, whatever the data holds. */
  readonly restricted: BriefLine | null;
  readonly footer: readonly string[];
  /** Every insight a line cites, sorted: the set the brief was composed from. */
  readonly insightIds: readonly string[];
  readonly counts: Readonly<Record<string, number>>;
};

export const RISK_CAP = 5;
export const TREAT_WITH_CARE_CAP = 3;
export const WORTH_KNOWING_CAP = 3;

/* ------------------------------------------------------------------ */
/* Dates                                                                */
/* ------------------------------------------------------------------ */

const TZ = "Asia/Kolkata";
// en-US for the parts: some ICU builds spell September "Sept" under en-GB. The order is built below.
const dayParts = new Intl.DateTimeFormat("en-US", { timeZone: TZ, weekday: "short", day: "numeric", month: "short" });
const weekdayLong = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, weekday: "long" });
const clock = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

function part(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes): string {
  return parts.find((p) => p.type === type)?.value ?? "";
}

/** Formats an instant in IST. Exported for the grounding test, which re-derives every date part. */
export function formatDate(at: Date, format: DateFormat): string {
  switch (format) {
    case "day": {
      const p = dayParts.formatToParts(at);
      return `${part(p, "weekday")} ${part(p, "day")} ${part(p, "month")}`;
    }
    case "short_day":
    case "last_day": {
      const p = dayParts.formatToParts(at);
      return `${part(p, "day")} ${part(p, "month")}`;
    }
    case "weekday":
      return weekdayLong.format(at);
    case "time":
      return clock.format(at);
    default:
      return assertNever(format);
  }
}

/** The instant a date part renders: last_day renders the day before a period's exclusive end. */
export function instantFor(iso: string, format: DateFormat): Date {
  const at = new Date(iso);
  return format === "last_day" ? new Date(at.getTime() - 1) : at;
}

/* ------------------------------------------------------------------ */
/* Composition                                                          */
/* ------------------------------------------------------------------ */

type Slots = Readonly<Record<string, BriefPart>>;

function fill(pattern: string, slots: Slots): BriefPart[] | null {
  const parts: BriefPart[] = [];
  for (const piece of T.parseTemplate(pattern)) {
    if (piece.kind === "text") {
      parts.push({ kind: "text", text: piece.text });
    } else {
      const slot = slots[piece.name];
      if (!slot) return null;
      parts.push(slot);
    }
  }
  return parts;
}

function line(key: string, claimType: BriefLine["claimType"], insightIds: readonly string[], severity: BriefLine["severity"], parts: readonly BriefPart[]): BriefLine {
  return { key, claimType, insightIds, severity, parts, text: parts.map((p) => p.text).join("") };
}

const word = (text: string): BriefPart => ({ kind: "word", text });

function dateOf(source: DateSource, iso: string, format: DateFormat): BriefPart {
  return { kind: "date", text: formatDate(instantFor(iso, format), format), format, source };
}

const briefDate = (date: string, format: DateFormat): BriefPart => dateOf({ from: "brief_date" }, startOfBusinessDay(date).toISOString(), format);

function listWords(words: readonly string[]): string {
  const unique = [...new Set(words)];
  if (unique.length <= 1) return unique[0] ?? "";
  return `${unique.slice(0, -1).join(", ")} and ${unique.at(-1)}`;
}

type Grade = "HIGH" | "MEDIUM" | "LOW" | "UNKNOWN";

function reasonsOf(trust: TrustRef): readonly string[] {
  return trust.state === "NOT_MEASURED" ? [] : trust.reasons;
}

function gradeOf(trust: TrustRef): Grade {
  for (const reason of reasonsOf(trust)) {
    if (reason === "GRADE_HIGH" || reason === "GRADE_MEDIUM" || reason === "GRADE_LOW" || reason === "GRADE_UNKNOWN") {
      return reason.slice("GRADE_".length) as Grade;
    }
  }
  return "UNKNOWN";
}

function trustReasonWords(trust: TrustRef): string {
  for (const reason of reasonsOf(trust)) {
    const words = T.SIGNAL_REASONS[reason];
    if (words) return words;
  }
  return T.UNSCORED_REASON;
}

const isCapped = (insight: Insight) => reasonsOf(insight.trust).includes(CAPPED_LOW_TRUST);

type Area = keyof typeof T.GENERIC_TEMPLATES;

function areaOf(insight: Insight): Area {
  const prefix = insight.producer.split(".")[0];
  return prefix === "recon" || prefix === "sig" || prefix === "detect" || prefix === "pulse" ? prefix : "other";
}

const isLedger = (insight: Insight) => areaOf(insight) === "recon" || areaOf(insight) === "sig";

type Lifecycle = "ACTIVE" | "RESOLVED" | "RECOVERED";

function lifecycleOf(insight: BriefInsight): Lifecycle {
  if (insight.status !== "EXPIRED" || insight.statusReason === "CLOSING_TIME") return "ACTIVE";
  return areaOf(insight) === "pulse" ? "RECOVERED" : "RESOLVED";
}

/** Whether a stored insight belongs to the brief's day. */
function isForDay(insight: BriefInsight, date: string): boolean {
  if (insight.producer === BRIEF_PRODUCER) return insight.dedupeKey.endsWith(`:${date}`);
  if (areaOf(insight) === "sig") {
    // Signatures keep one key per rule and look back 48 h: a finding still open covers the day,
    // and one that cleared counts when its window reached into the day.
    const dayStart = startOfBusinessDay(date).getTime();
    const dayEnd = endOfBusinessDay(date).getTime();
    return Date.parse(insight.period.start) < dayEnd && (insight.status === "ACTIVE" || Date.parse(insight.period.end) > dayStart);
  }
  return businessDate(new Date(insight.period.start)) === date;
}

export function composeBrief(input: BriefInput): Brief {
  const counts: Record<string, number> = {};
  const count = (key: string) => (counts[key] = (counts[key] ?? 0) + 1);
  const cited = new Set<string>();
  const cite = (l: BriefLine | null) => {
    if (l) for (const id of l.insightIds) cited.add(id);
    return l;
  };

  // 1. The insight set: created by the read time, not retracted, the replacement of anything superseded.
  const readMs = input.readAt.getTime();
  const existing = input.insights.filter((i) => Date.parse(i.createdAt) <= readMs && i.status !== "RETRACTED" && isForDay(i, input.date));
  const existingIds = new Set(existing.map((i) => i.id));
  const current = existing.filter((i) => !(i.status === "SUPERSEDED" && i.supersededBy !== null && existingIds.has(i.supersededBy)));
  const { items, restricted } = presentFor(current, input.viewer);
  const presented = new Map<string, Presentation>(items.map((p) => [p.insightId, p]));
  const visible = current.filter((i) => presented.has(i.id));

  const asOf = line("as_of", "NOTE", [], null, fill(T.SECTION_COPY.asOf, {
    time: dateOf({ from: "read_at" }, input.readAt.toISOString(), "time"),
    date: dateOf({ from: "read_at" }, input.readAt.toISOString(), "day"),
  })!);
  const heading = line("yesterday", "NOTE", [], null, fill(T.SECTION_COPY.yesterday.subline, { date: briefDate(input.date, "day") })!);
  const restrictedLine = restricted ? line("restricted", "NOTE", [], null, [{ kind: "text", text: T.SECTION_COPY.restricted }]) : null;

  // 2. Yesterday.
  const factFor = (metricId: string, window: BriefWindow) =>
    visible.find(
      (i): i is BriefInsight & InsightOf<"FACT"> =>
        i.claimType === "FACT" && i.producer === BRIEF_PRODUCER && i.dedupeKey === briefFactKey(metricId, input.date, window),
    );
  const yesterday: BriefLine[] = [];
  for (const metric of T.BRIEF_DAY_METRICS) {
    const fact = factFor(metric, "day");
    if (!fact) {
      count(`fact_missing:${metric}`);
      continue;
    }
    const parts = fill(T.FACT_TEMPLATES[metric], { value: factPart(fact, presented) });
    yesterday.push(line(`fact:${metric}`, "FACT", [fact.id], null, [...parts!, ...trustNote(fact)]));
  }

  if (yesterday.length === 0) {
    return {
      state: "NOT_READY",
      date: input.date,
      asOf,
      notReady: line("not_ready", "NOTE", [], null, fill(T.SECTION_COPY.notReady, { date: briefDate(input.date, "day") })!),
      yesterday: { heading, lines: [] },
      risks: { lines: [], more: null, known: [], resolved: [], empty: null },
      worthKnowing: { lines: [], more: null },
      treatWithCare: { lines: [], more: null },
      restricted: restrictedLine,
      footer: T.NOT_CHECKED_FOOTER,
      insightIds: [],
      counts,
    };
  }

  const mtd = factFor("revenue_net", "month_to_date");
  const previous = factFor("revenue_net", "same_days_last_month");
  if (mtd && previous) {
    const days = (i: Insight) => Math.round((Date.parse(i.period.end) - Date.parse(i.period.start)) / 86_400_000);
    const parts = fill(T.MONTH_TO_DATE_TEMPLATE, {
      current: factPart(mtd, presented),
      currentFrom: dateOf({ from: "insight", insightId: mtd.id, edge: "start" }, mtd.period.start, "short_day"),
      currentTo: dateOf({ from: "insight", insightId: mtd.id, edge: "end" }, mtd.period.end, "last_day"),
      previous: factPart(previous, presented),
      previousFrom: dateOf({ from: "insight", insightId: previous.id, edge: "start" }, previous.period.start, "short_day"),
      previousTo: dateOf({ from: "insight", insightId: previous.id, edge: "end" }, previous.period.end, "last_day"),
    })!;
    const clamped = days(previous) < days(mtd) ? [{ kind: "text", text: T.MONTH_TO_DATE_CLAMPED } as const] : [];
    yesterday.push(line("fact:revenue_net:month_to_date", "FACT", [mtd.id, previous.id], null, [...parts, ...clamped]));
  } else {
    count("fact_missing:revenue_net:month_to_date");
  }

  // 3. Detections, sorted into risks, known issues, resolved, worth knowing and treat with care.
  const detections = visible.filter((i): i is BriefInsight & InsightOf<"DETECTION"> => i.claimType === "DETECTION");
  const riskMembers: Member[] = [];
  const knownMembers: Member[] = [];
  const resolvedMembers: Member[] = [];
  const worthKnowing: Ranked[] = [];
  const capped: Ranked[] = [];
  const trustDrops = new Map<string, { metrics: string[]; ids: string[]; refs: string[] }>();
  const cappedRefs = new Set<string>();

  for (const insight of detections) {
    const presentation = presented.get(insight.id) as DetectionPresentation;
    const lifecycle = lifecycleOf(insight);
    const severity = insight.payload.severity;
    if (insight.payload.ruleId === "trust.grade_dropped") {
      if (lifecycle !== "ACTIVE") continue;
      const reason = trustReasonWords(insight.trust);
      const group = trustDrops.get(reason) ?? { metrics: [], ids: [], refs: [] };
      group.refs.push(insight.subject.ref);
      group.ids.push(insight.id);
      trustDrops.set(reason, group);
      continue;
    }
    const sentence = detectionSentence(insight, presentation);
    if (!sentence.templated) count("lines_generic");
    const card = input.explainedBy?.(insight) ?? T.explainingCardOf(insight.copy.templateId);
    const member: Member = { insight, sentence: sentence.parts, card, lifecycle };

    if (lifecycle !== "ACTIVE") {
      if (severity >= 2) resolvedMembers.push(member);
    } else if (isCapped(insight)) {
      cappedRefs.add(insight.subject.ref);
      const parts = [...sentence.parts, ...fill(T.STATUS_SUFFIX.CAPPED, { reason: word(trustReasonWords(insight.trust)) })!];
      capped.push({ rank: rankOf([insight]), line: line(`capped:${insight.dedupeKey}`, "DETECTION", [insight.id], severity, parts) });
    } else if (card !== null) {
      knownMembers.push(member);
    } else if (severity >= 2) {
      riskMembers.push(member);
    } else {
      worthKnowing.push({ rank: rankOf([insight]), line: line(`worth:${insight.dedupeKey}`, "DETECTION", [insight.id], severity, sentence.parts) });
    }
  }

  const riskGroups = groupMembers(riskMembers).sort(byRank);
  const sevThree = riskGroups.filter((g) => g.rank.severity === 3);
  const shownRisks = [...sevThree, ...riskGroups.filter((g) => g.rank.severity !== 3)].slice(0, Math.max(RISK_CAP, sevThree.length));
  const riskLines = shownRisks.map((g) => cite(g.line)!);
  const riskMore = moreLine("risks", riskGroups.length - shownRisks.length);
  const known = groupMembers(knownMembers).sort(byRank).map((g) => cite(g.line)!);
  const resolved = groupMembers(resolvedMembers).sort(byRank).map((g) => cite(g.line)!);

  // 4. Treat with care: checks that did not run, the parity check, capped findings, trust drops, skipped comparisons.
  const care: BriefLine[] = [];
  const visibleChecks: T.CheckName[] = input.viewer.financeView ? ["detect", "reconcile", "signatures"] : ["detect"];
  for (const check of visibleChecks) {
    const run = input.checks[check];
    if (run === "SUCCEEDED") continue;
    const pattern = run === "FAILED" ? T.CHECK_FAILED : T.CHECK_NOT_RUN;
    care.push(line(`check:${check}`, "CHECK", [], null, fill(pattern, { check: word(T.CHECK_WORDS[check]), date: briefDate(input.date, "day") })!));
  }
  if (input.parity.state === "NOT_CHECKED" || !input.parity.matched) {
    const pattern = input.parity.state === "NOT_CHECKED" ? T.PARITY_NOT_CHECKED : T.PARITY_MISMATCH;
    care.push(line("check:parity", "CHECK", [], null, fill(pattern, { date: briefDate(input.date, "day") })!));
  }
  care.push(...capped.sort(byRank).map((c) => c.line));
  for (const [reason, group] of [...trustDrops].sort(([a], [b]) => a.localeCompare(b))) {
    // A figure whose finding is already under Treat with care says why there; do not repeat it.
    const keep = group.refs.map((ref, i) => ({ ref, id: group.ids[i]! })).filter((g) => !cappedRefs.has(g.ref));
    if (keep.length === 0) continue;
    group.metrics = keep.map((g) => T.FIGURE_WORDS[g.ref] ?? "a figure");
    group.ids = keep.map((g) => g.id);
    const parts = fill(T.TRUST_DROPPED, { metrics: word(listWords(group.metrics)), reason: word(reason) })!;
    care.push(line(`trust:${reason}`, "DETECTION", [...group.ids].sort(), 1, parts));
  }
  if (input.checks.detect === "SUCCEEDED") care.push(...notEvaluatedLines(input.detectSummary));
  const careShown = care.slice(0, TREAT_WITH_CARE_CAP).map((l) => cite(l)!);

  const worthShown = worthKnowing.sort(byRank).slice(0, WORTH_KNOWING_CAP).map((w) => cite(w.line)!);

  let empty: BriefLine | null = null;
  if (riskLines.length === 0 && known.length === 0) {
    const allRan = visibleChecks.every((check) => input.checks[check] === "SUCCEEDED");
    const text = !allRan ? T.EMPTY_RISKS.CHECKS_INCOMPLETE : input.viewer.financeView ? T.EMPTY_RISKS.NO_RISKS : T.EMPTY_RISKS.NO_RISKS_SALES_ONLY;
    empty = line("risks:empty", "CHECK", [], null, [{ kind: "text", text }]);
  }

  for (const l of yesterday) cite(l);
  return {
    state: "READY",
    date: input.date,
    asOf,
    notReady: null,
    yesterday: { heading, lines: yesterday },
    risks: { lines: riskLines, more: riskMore, known, resolved, empty },
    worthKnowing: { lines: worthShown, more: moreLine("worth", worthKnowing.length - worthShown.length) },
    treatWithCare: { lines: careShown, more: moreLine("care", care.length - careShown.length) },
    restricted: restrictedLine,
    footer: T.NOT_CHECKED_FOOTER,
    insightIds: [...cited].sort(),
    counts,
  };

  /* -- helpers that close over the input -- */

  function trustNote(fact: BriefInsight): BriefPart[] {
    const grade = gradeOf(fact.trust);
    if (grade === "HIGH") return [];
    return fill(T.TRUST_NOTE[grade], { reason: word(trustReasonWords(fact.trust)) })!;
  }

  function groupMembers(members: readonly Member[]): Ranked[] {
    const groups = new Map<string, Member[]>();
    for (const m of members) {
      const ruleGroup = T.RULE_GROUPS[m.insight.payload.ruleId];
      const key = m.card !== null ? `card:${m.card}` : ruleGroup ? `group:${ruleGroup}` : `rule:${m.insight.dedupeKey}`;
      groups.set(key, [...(groups.get(key) ?? []), m]);
    }
    return [...groups].map(([key, group]) => {
      const sorted = [...group].sort((a, b) => byRank({ rank: rankOf([a.insight]) }, { rank: rankOf([b.insight]) }));
      const first = sorted[0]!;
      const ruleGroup = T.RULE_GROUPS[first.insight.payload.ruleId];
      const groupPattern = ruleGroup ? T.GROUP_TEMPLATES[ruleGroup] : undefined;
      let parts: BriefPart[] = sorted.length > 1 && groupPattern ? fill(groupPattern, {})! : [...first.sentence];
      if (first.lifecycle === "RESOLVED") parts = [...parts, { kind: "text", text: T.STATUS_SUFFIX.RESOLVED }];
      if (first.lifecycle === "RECOVERED") parts = [...parts, { kind: "text", text: T.STATUS_SUFFIX.RECOVERED }];
      if (first.card !== null) parts = [...parts, ...fill(T.STATUS_SUFFIX.KNOWN_ISSUE, { card: { kind: "ref", text: first.card } })!];
      const insights = sorted.map((m) => m.insight);
      const rank = rankOf(insights);
      return { rank, line: line(key, "DETECTION", insights.map((i) => i.id).sort(), rank.severity, parts) };
    });
  }

  function moreLine(section: string, n: number): BriefLine | null {
    if (n <= 0) return null;
    return line(`${section}:more`, "NOTE", [], null, fill(T.SECTION_COPY.more, { count: { kind: "count", text: String(n), value: n } })!);
  }
}

type Member = {
  readonly insight: BriefInsight & InsightOf<"DETECTION">;
  readonly sentence: readonly BriefPart[];
  readonly card: string | null;
  readonly lifecycle: Lifecycle;
};

type Rank = { readonly severity: 1 | 2 | 3; readonly ledger: boolean; readonly deviation: number; readonly key: string };
type Ranked = { readonly rank: Rank; readonly line: BriefLine };

function rankOf(insights: readonly (Insight & InsightOf<"DETECTION">)[]): Rank {
  return {
    severity: Math.max(...insights.map((i) => i.payload.severity)) as 1 | 2 | 3,
    ledger: insights.some(isLedger),
    deviation: Math.max(...insights.map((i) => Math.abs(i.payload.deviationBps))),
    key: insights.map((i) => i.dedupeKey).sort()[0]!,
  };
}

/** Severity first; within a severity, payment-ledger findings (their deviation is defined, not measured), then the larger change. */
function byRank(a: { readonly rank: Rank }, b: { readonly rank: Rank }): number {
  if (a.rank.severity !== b.rank.severity) return b.rank.severity - a.rank.severity;
  if (a.rank.ledger !== b.rank.ledger) return a.rank.ledger ? -1 : 1;
  if (a.rank.deviation !== b.rank.deviation) return b.rank.deviation - a.rank.deviation;
  return a.rank.key.localeCompare(b.rank.key);
}

function factPart(fact: BriefInsight & InsightOf<"FACT">, presented: ReadonlyMap<string, Presentation>): BriefPart {
  const presentation = presented.get(fact.id) as FactPresentation;
  return { kind: "figure", text: presentation.figure.text, insightId: fact.id, slot: "value", unsigned: false };
}

/** Drops a leading minus: the sentence already says "below". */
export function unsignedText(text: string): string {
  return text.replace(/^[-−]/, "");
}

function detectionSentence(
  insight: BriefInsight & InsightOf<"DETECTION">,
  presentation: DetectionPresentation,
): { readonly parts: readonly BriefPart[]; readonly templated: boolean } {
  const pattern = T.DETECTION_TEMPLATES[insight.copy.templateId];
  if (pattern) {
    const parts = fill(pattern, {
      observed: { kind: "figure", text: presentation.observed.text, insightId: insight.id, slot: "observed", unsigned: false },
      baseline: { kind: "figure", text: presentation.baseline.text, insightId: insight.id, slot: "baseline", unsigned: false },
      deviation: { kind: "figure", text: unsignedText(presentation.deviation), insightId: insight.id, slot: "deviation", unsigned: true },
      weekday: dateOf({ from: "insight", insightId: insight.id, edge: "start" }, insight.period.start, "weekday"),
      direction: word(insight.payload.deviationBps < 0 ? "below" : "above"),
      start: dateOf({ from: "insight", insightId: insight.id, edge: "start" }, insight.period.start, "time"),
      end: dateOf({ from: "insight", insightId: insight.id, edge: "end" }, insight.period.end, "time"),
    });
    if (parts) return { parts, templated: true };
  }
  const area = areaOf(insight);
  const parts = fill(T.GENERIC_TEMPLATES[area], { metric: word(T.FIGURE_WORDS[insight.subject.ref] ?? "a figure") })!;
  return { parts, templated: false };
}

function notEvaluatedLines(summary: Readonly<Record<string, number>> | null): BriefLine[] {
  if (!summary) return [];
  const byReason = new Map<string, string[]>();
  for (const [key, n] of Object.entries(summary)) {
    const match = /^not_evaluated:(.+):([a-z_]+)$/.exec(key);
    if (!match || n <= 0) continue;
    const [, ruleId, reason] = match;
    const metric = T.RULE_WORDS[ruleId!];
    if (!metric || !T.NOT_EVALUATED_REASONS[reason!]) continue;
    byReason.set(reason!, [...(byReason.get(reason!) ?? []), metric]);
  }
  return [...byReason]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([reason, metrics]) =>
      line(`not_evaluated:${reason}`, "CHECK", [], null, fill(T.NOT_EVALUATED, { metrics: word(listWords(metrics)), reason: word(T.NOT_EVALUATED_REASONS[reason]!) })!),
    );
}

function assertNever(value: never): never {
  throw new Error(`brief: unhandled ${String(value)}`);
}

/** The brief as plain text, section by section — what the grounding test scans for digits. */
export function renderBriefText(brief: Brief): string {
  const out: string[] = [brief.asOf.text];
  if (brief.notReady) out.push(brief.notReady.text);
  const section = (heading: string, lines: readonly (BriefLine | null)[]) => {
    const present = lines.filter((l): l is BriefLine => l !== null);
    if (present.length > 0) out.push(heading, ...present.map((l) => l.text));
  };
  section(`${T.SECTION_COPY.yesterday.heading} — ${brief.yesterday.heading.text}`, brief.yesterday.lines);
  section(T.SECTION_COPY.risks.heading, [...brief.risks.lines, brief.risks.more, brief.risks.empty, ...brief.risks.known, ...brief.risks.resolved, brief.restricted]);
  section(T.SECTION_COPY.worthKnowing.heading, [...brief.worthKnowing.lines, brief.worthKnowing.more]);
  section(T.SECTION_COPY.treatWithCare.heading, [...brief.treatWithCare.lines, brief.treatWithCare.more]);
  out.push(T.SECTION_COPY.footer.heading, ...brief.footer);
  return out.join("\n");
}
