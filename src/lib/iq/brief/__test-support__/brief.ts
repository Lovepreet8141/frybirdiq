/**
 * Brief fixtures built by the real writers: brief FACTs come from `runBriefDaily`
 * and detector findings from `runDetectDaily`, so the composer is tested on
 * exactly what the jobs store. Hand-built detections are only for producers
 * that have no job body yet (recon.*, sig.*, pulse.*).
 */
import { addDays } from "@/lib/dates";
import { baselineDates } from "@/lib/iq/detect/baseline";
import { day, type DayOptions } from "@/lib/iq/detect/__test-support__/days";
import { runDetectDaily, type DetectJobPorts } from "@/lib/iq/detect/detect-job";
import { InsightSchema, type FigureTrust, type Insight, type InsightOf, type TrustRef } from "@/lib/iq/engine";
import { observed } from "@/lib/iq/engine/observed-factory";

import { runBriefDaily, type BriefFigure, type BriefFiguresRead } from "../brief-job";
import type { BriefInput, BriefInsight } from "../compose";

export const ORG = "11111111-1111-4111-8111-111111111111";
export const RUN = "22222222-2222-4222-8222-222222222222";
/** A Friday. */
export const DATE = "2026-09-11";

let sequence = 0;
export function nextId(): string {
  sequence += 1;
  return `bbbbbbbb-0000-4000-8000-${String(sequence).padStart(12, "0")}`;
}

/** 07:30 IST the morning after `date`. */
export function morningAfter(date: string): Date {
  return new Date(`${addDays(date, 1)}T07:30:00+05:30`);
}

export function trust(grade: FigureTrust["grade"] = "HIGH", signalId: string | null = null): FigureTrust {
  return { grade, signalId, ratio: { numerator: 95n, denominator: 100n }, asOf: "2026-09-12T02:00:00+05:30" };
}

export type SeedFigures = {
  readonly revenue_net?: bigint | null;
  readonly orders_paid?: number | null;
  readonly aov_net?: bigint | null;
  readonly food_cost_pct_theoretical?: number | null;
  readonly net_collected?: bigint | null;
  readonly monthToDate?: bigint | null;
  readonly sameDaysLastMonth?: bigint | null;
  readonly trust?: Partial<Record<"revenue_net" | "orders_paid" | "aov_net" | "food_cost_pct_theoretical" | "net_collected", FigureTrust>>;
};

const money = (v: bigint, t: FigureTrust): BriefFigure => ({ value: observed({ unit: "paise", value: v.toString() }), trust: t });
const whole = (unit: "count" | "bps", v: number, t: FigureTrust): BriefFigure => ({ value: observed({ unit, value: v }), trust: t });

function pick<V>(value: V | null | undefined, fallback: V): V | null {
  return value === undefined ? fallback : value;
}

export function figuresRead(seed: SeedFigures = {}): BriefFiguresRead {
  const t = (id: keyof NonNullable<SeedFigures["trust"]>) => seed.trust?.[id] ?? trust();
  const day: Partial<Record<string, BriefFigure>> = {};
  const revenue = pick(seed.revenue_net, 1000000n);
  if (revenue !== null) day.revenue_net = money(revenue, t("revenue_net"));
  const orders = pick(seed.orders_paid, 40);
  if (orders !== null) day.orders_paid = whole("count", orders, t("orders_paid"));
  const aov = pick(seed.aov_net, 25000n);
  if (aov !== null) day.aov_net = money(aov, t("aov_net"));
  const food = pick(seed.food_cost_pct_theoretical, 3150);
  if (food !== null) day.food_cost_pct_theoretical = whole("bps", food, t("food_cost_pct_theoretical"));
  const collected = pick(seed.net_collected, 1180000n);
  if (collected !== null) day.net_collected = money(collected, t("net_collected"));
  const mtd = pick(seed.monthToDate, 11000000n);
  const previous = pick(seed.sameDaysLastMonth, 10400000n);
  return {
    day,
    monthToDate: mtd === null ? null : money(mtd, trust()),
    sameDaysLastMonth: previous === null ? null : money(previous, trust()),
  };
}

export function stored(insight: Insight, extra: { status?: Insight["status"]; statusReason?: string | null; supersededBy?: string | null; createdAt?: string } = {}): BriefInsight {
  const parsed = InsightSchema.parse({
    ...insight,
    ...(extra.status ? { status: extra.status } : {}),
    ...(extra.createdAt ? { createdAt: extra.createdAt } : {}),
  });
  return { ...parsed, statusReason: extra.statusReason ?? null, supersededBy: extra.supersededBy ?? null };
}

/** The FACTs `runBriefDaily` writes for `date`. */
export async function briefFacts(date: string, seed: SeedFigures = {}, openedOn: string | null = null): Promise<BriefInsight[]> {
  const written: InsightOf<"FACT">[] = [];
  await runBriefDaily({
    orgId: ORG,
    runId: RUN,
    attempt: 1,
    codeVersion: "93fd9c5",
    date,
    openedOn,
    factsReady: async () => true,
    readFigures: async () => figuresRead(seed),
    newId: nextId,
    now: () => new Date(`${addDays(date, 1)}T02:00:00Z`),
    commit: (write) =>
      write({
        writeInsight: async (insight) => {
          written.push(insight);
          return { outcome: "INSERTED" };
        },
      }),
  });
  return written.map((i) => stored(i));
}

/** The detections and run summary `runDetectDaily` produces for `date` with flat baselines. */
export async function detections(date: string, today: DayOptions = {}): Promise<{ insights: BriefInsight[]; summary: Readonly<Record<string, number>> }> {
  const written: InsightOf<"DETECTION">[] = [];
  const days = [day(date, today), day(addDays(date, -1)), ...baselineDates(date).map((d) => day(d))];
  const ports: DetectJobPorts = {
    orgId: ORG,
    runId: RUN,
    attempt: 1,
    codeVersion: "93fd9c5",
    date,
    factsReady: async () => true,
    readDays: async (dates) => days.filter((d) => dates.includes(d.date)),
    readFoodCostTarget: async () => null,
    newId: nextId,
    now: () => new Date(`${date}T21:15:00Z`),
    commit: (write) =>
      write({
        writeInsight: async (insight) => {
          written.push(insight);
          return { outcome: "INSERTED" };
        },
        expireInsights: async () => ({ expired: 0 }),
      }),
  };
  const result = await runDetectDaily(ports);
  return { insights: written.map((i) => stored(i)), summary: result.summary };
}

export type RawDetection = {
  readonly producer: string;
  readonly ruleId: string;
  readonly templateId?: string;
  readonly severity?: 1 | 2 | 3;
  readonly deviationBps?: number;
  readonly date?: string;
  readonly period?: { readonly start: string; readonly end: string };
  readonly subjectRef?: string;
  readonly trust?: TrustRef;
  readonly observed?: bigint;
  readonly baseline?: bigint;
  readonly dedupeKey?: string;
};

/** A hand-built DETECTION for producers without a job body in this branch. */
export function detection(raw: RawDetection, extra: Parameters<typeof stored>[1] = {}): BriefInsight {
  const date = raw.date ?? DATE;
  const period = raw.period ?? { start: `${date}T00:00:00+05:30`, end: `${addDays(date, 1)}T00:00:00+05:30` };
  const id = nextId();
  return stored(
    {
      id,
      orgId: ORG,
      locationId: null,
      schemaVersion: 1,
      producer: raw.producer,
      subject: raw.subjectRef ? { kind: "METRIC", ref: raw.subjectRef } : { kind: "ORG", ref: "org" },
      period,
      dedupeKey: raw.dedupeKey ?? `${raw.ruleId}:${date}:${id.slice(-4)}`,
      evidence: [{ kind: "query", sourceId: raw.ruleId, paramsHash: "c".repeat(64) }],
      trust: raw.trust ?? { state: "MEASURED", score: 100, asOf: "2026-09-12T02:00:00+05:30", metricIds: ["captured_amount"], reasons: ["GRADE_HIGH"] },
      copy: { templateId: raw.templateId ?? raw.ruleId, slots: { observed: "observed", baseline: "baseline.value", deviation: "deviationBps" } },
      status: "ACTIVE",
      producedBy: { job: "iq-reconcile-nightly", runId: RUN, attempt: 1, codeVersion: "93fd9c5" },
      contentHash: "d".repeat(64),
      supersedes: null,
      createdAt: `${addDays(date, 1)}T03:00:00+05:30`,
      expiresAt: null,
      claimType: "DETECTION",
      payload: {
        ruleId: raw.ruleId,
        observed: observed({ unit: "count", value: Number(raw.observed ?? 3n) }),
        baseline: { method: "threshold", value: observed({ unit: "count", value: Number(raw.baseline ?? 0n) }), windowWeeks: 0 },
        deviationBps: raw.deviationBps ?? 10000,
        severity: raw.severity ?? 3,
      },
    } as Insight,
    extra,
  );
}

export const ALL_RAN: BriefInput["checks"] = { detect: "SUCCEEDED", reconcile: "SUCCEEDED", signatures: "SUCCEEDED" };
export const OWNER = { financeView: true } as const;
export const ANALYST = { financeView: false } as const;

export function input(date: string, insights: readonly BriefInsight[], extra: Partial<BriefInput> = {}): BriefInput {
  return {
    date,
    readAt: morningAfter(date),
    viewer: OWNER,
    insights,
    checks: ALL_RAN,
    parity: { state: "CHECKED", matched: true },
    detectSummary: {},
    ...extra,
  };
}
