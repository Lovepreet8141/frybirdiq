/**
 * present() — the only way an insight reaches the screen.
 *
 * DESIGN.md §1.4 (3) and review answer A2: formatting happens here, in
 * src/lib, so components under src/components/iq/insight render a
 * `Presentation` and never touch a raw quantity or `formatINR` themselves.
 *
 * Every variant carries a badge, and the badge is fixed by the claim type —
 * a component cannot choose "Fact" for a forecast. FORECAST and
 * RECOMMENDATION variants carry a range and declare `bareNumber?: never`, so
 * a single forecast figure has nowhere to go. A `FactFigure` can be built
 * only from an Observed quantity.
 */
import { formatBps, formatINR, paise } from "@/lib/money";

import type { ActionTier } from "./claims";
import { classifySlotValue, resolvePayloadPath, type Insight, type InsightOf } from "./insight";
import type { Estimated, Interval, Observed, Quantity, Range } from "./quantity";
import type { TrustRef } from "./trust";

export type BadgeLabel =
  | "Fact"
  | "Detected"
  | "Forecast"
  | "Why"
  | "Suggested"
  | "Done automatically"
  | "Waiting approval";

export type Badge = { readonly label: BadgeLabel; readonly claimType: Insight["claimType"] };

declare const FACT_FIGURE: unique symbol;
/** A rendered figure that came from stored rows. Only `factFigure` makes one. */
export type FactFigure = { readonly text: string; readonly [FACT_FIGURE]: true };

export type TrustNote = { readonly state: TrustRef["state"]; readonly text: string };

export type RenderedCopy = { readonly templateId: string; readonly slots: Readonly<Record<string, string>> };

type Common = {
  readonly insightId: string;
  readonly badge: Badge;
  readonly trust: TrustNote;
  readonly copy: RenderedCopy;
};

export type FactPresentation = Common & {
  readonly kind: "FACT";
  readonly metricId: string;
  readonly figure: FactFigure;
};

export type DetectionPresentation = Common & {
  readonly kind: "DETECTION";
  readonly ruleId: string;
  readonly observed: FactFigure;
  readonly baseline: FactFigure;
  readonly deviation: string;
  readonly severity: 1 | 2 | 3;
};

export type ForecastPresentation = Common & {
  readonly kind: "FORECAST";
  /** The p10–p90 band. The median is deliberately absent: it is one figure. */
  readonly range: { readonly text: string; readonly low: string; readonly high: string; readonly coverage: string };
  readonly horizonDays: number;
  readonly isNaiveFallback: boolean;
  /** True when the model's backtest error is below the naive baseline's. */
  readonly beatsNaive: boolean;
  readonly bareNumber?: never;
};

export type ExplanationPresentation = Common & {
  readonly kind: "EXPLANATION";
  readonly total: FactFigure;
  readonly drivers: readonly { readonly driverId: string; readonly contribution: FactFigure }[];
  /** Always shown, and always marked as an estimate. */
  readonly residual: string;
};

export type RecommendationPresentation = Common & {
  readonly kind: "RECOMMENDATION";
  readonly actionKind: string;
  readonly tier: ActionTier;
  readonly impact: { readonly low: string; readonly high: string; readonly basis: Range["basis"] };
  readonly confidence: "LOW" | "MEDIUM" | "HIGH";
  readonly expiresAt: string;
  /** A3 is handed to a person with a link, never approved in the app (AA6). */
  readonly decision: "APPROVE_OR_DISMISS" | "HANDOFF";
  readonly bareNumber?: never;
};

export type AutomationPresentation = Common & {
  readonly kind: "AUTOMATION";
  readonly actionKind: string;
  readonly tier: "A0" | "A1" | "A2";
  readonly undoAvailable: boolean;
};

export type Presentation =
  | FactPresentation
  | DetectionPresentation
  | ForecastPresentation
  | ExplanationPresentation
  | RecommendationPresentation
  | AutomationPresentation;

const BADGE_LABEL = {
  FACT: "Fact",
  DETECTION: "Detected",
  FORECAST: "Forecast",
  EXPLANATION: "Why",
  RECOMMENDATION: "Suggested",
} as const satisfies Record<Exclude<Insight["claimType"], "AUTOMATION">, BadgeLabel>;

const UNIT_SUFFIX: Record<Exclude<Quantity["unit"], "paise" | "bps">, string> = {
  count: "",
  grams: " g",
  ml: " ml",
  pieces: " pcs",
  seconds: " s",
};

const integer = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });

function formatQuantity(q: Quantity): string {
  switch (q.unit) {
    case "paise":
      return formatINR(paise(BigInt(q.value)));
    case "bps":
      return formatBps(q.value);
    default:
      return `${integer.format(q.value)}${UNIT_SUFFIX[q.unit]}`;
  }
}

export function factFigure(q: Observed): FactFigure {
  return { text: formatQuantity(q) } as FactFigure;
}

function formatEstimate(q: Estimated): string {
  return `≈ ${formatQuantity(q)}`;
}

function formatBand(low: Estimated, high: Estimated): string {
  return `${formatQuantity(low)} – ${formatQuantity(high)}`;
}

const istDateTime = new Intl.DateTimeFormat("en-IN", {
  timeZone: "Asia/Kolkata",
  dateStyle: "medium",
  timeStyle: "short",
});

function trustNote(trust: TrustRef): TrustNote {
  switch (trust.state) {
    case "MEASURED":
      return { state: trust.state, text: `Data trust ${trust.score}/100` };
    case "NOT_MEASURED":
      return { state: trust.state, text: "trust not measured yet" };
    case "INSUFFICIENT_DATA":
      return { state: trust.state, text: "not enough data to measure trust" };
    default:
      return assertNever(trust);
  }
}

/**
 * Fills the template's slots from the payload. The schema already refused
 * slots that cite part of a figure, or a bare figure in a FORECAST or
 * RECOMMENDATION; this renders what is left with the same formatter the
 * cards use, so prose and numbers cannot disagree.
 */
function renderCopy(insight: Insight): RenderedCopy {
  const slots: Record<string, string> = {};
  for (const [slot, path] of Object.entries(insight.copy.slots)) {
    const value = resolvePayloadPath(insight.payload, path);
    switch (classifySlotValue(value)) {
      case "scalar":
        slots[slot] = typeof value === "number" ? integer.format(value) : String(value);
        break;
      case "quantity": {
        const q = value as Quantity;
        slots[slot] = isEstimatePath(insight, path) ? formatEstimate(q as Estimated) : formatQuantity(q);
        break;
      }
      case "interval": {
        const i = value as Interval;
        slots[slot] = formatBand(i.p10, i.p90);
        break;
      }
      case "range": {
        const r = value as Range;
        slots[slot] = formatBand(r.low, r.high);
        break;
      }
      default:
        throw new Error(`present: slot ${slot} does not cite a payload value (${path})`);
    }
  }
  return { templateId: insight.copy.templateId, slots };
}

/** Estimated quantities outside FORECAST/RECOMMENDATION: an explanation's residual. */
function isEstimatePath(insight: Insight, path: string): boolean {
  return insight.claimType === "EXPLANATION" && path === "residual";
}

function common(insight: Insight, badge: BadgeLabel): Common {
  return {
    insightId: insight.id,
    badge: { label: badge, claimType: insight.claimType },
    trust: trustNote(insight.trust),
    copy: renderCopy(insight),
  };
}

function presentFact(i: InsightOf<"FACT">): FactPresentation {
  return { ...common(i, BADGE_LABEL.FACT), kind: "FACT", metricId: i.payload.metricId, figure: factFigure(i.payload.value) };
}

function presentDetection(i: InsightOf<"DETECTION">): DetectionPresentation {
  return {
    ...common(i, BADGE_LABEL.DETECTION),
    kind: "DETECTION",
    ruleId: i.payload.ruleId,
    observed: factFigure(i.payload.observed),
    baseline: factFigure(i.payload.baseline.value),
    deviation: formatBps(i.payload.deviationBps),
    severity: i.payload.severity,
  };
}

function presentForecast(i: InsightOf<"FORECAST">): ForecastPresentation {
  const { interval, backtest } = i.payload;
  return {
    ...common(i, BADGE_LABEL.FORECAST),
    kind: "FORECAST",
    range: {
      text: formatBand(interval.p10, interval.p90),
      low: formatQuantity(interval.p10),
      high: formatQuantity(interval.p90),
      coverage: `${interval.nominalCoverage}% interval`,
    },
    horizonDays: i.payload.horizonDays,
    isNaiveFallback: i.payload.isNaiveFallback,
    beatsNaive: backtest.modelErrorBps < backtest.naiveErrorBps,
  };
}

function presentExplanation(i: InsightOf<"EXPLANATION">): ExplanationPresentation {
  return {
    ...common(i, BADGE_LABEL.EXPLANATION),
    kind: "EXPLANATION",
    total: factFigure(i.payload.total),
    drivers: i.payload.drivers.map((d) => ({ driverId: d.driverId, contribution: factFigure(d.contribution) })),
    residual: formatEstimate(i.payload.residual),
  };
}

function presentRecommendation(i: InsightOf<"RECOMMENDATION">): RecommendationPresentation {
  const { impact } = i.payload;
  return {
    ...common(i, BADGE_LABEL.RECOMMENDATION),
    kind: "RECOMMENDATION",
    actionKind: i.payload.actionKind,
    tier: i.payload.tier,
    impact: { low: formatQuantity(impact.low), high: formatQuantity(impact.high), basis: impact.basis },
    confidence: i.payload.confidence.level,
    expiresAt: istDateTime.format(new Date(i.payload.expiresAt)),
    decision: i.payload.tier === "A3" ? "HANDOFF" : "APPROVE_OR_DISMISS",
  };
}

function presentAutomation(i: InsightOf<"AUTOMATION">): AutomationPresentation {
  const badge = i.payload.execution === "EXECUTED" ? "Done automatically" : "Waiting approval";
  return {
    ...common(i, badge),
    kind: "AUTOMATION",
    actionKind: i.payload.actionKind,
    tier: i.payload.tier,
    undoAvailable: i.payload.undo.available,
  };
}

export function present(insight: Insight): Presentation {
  switch (insight.claimType) {
    case "FACT":
      return presentFact(insight);
    case "DETECTION":
      return presentDetection(insight);
    case "FORECAST":
      return presentForecast(insight);
    case "EXPLANATION":
      return presentExplanation(insight);
    case "RECOMMENDATION":
      return presentRecommendation(insight);
    case "AUTOMATION":
      return presentAutomation(insight);
    default:
      return assertNever(insight);
  }
}

function assertNever(value: never): never {
  throw new Error(`present: unhandled variant ${JSON.stringify(value)}`);
}
