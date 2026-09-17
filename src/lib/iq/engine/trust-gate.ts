/**
 * The trust gate and the TrustRef a detector writes.
 *
 * IQ-2 DESIGN.md §2 "Trust gating" and Revision 2 (R2.4, R2.9):
 * - HIGH or MEDIUM data: a detection publishes as its rule says.
 * - LOW or UNKNOWN data: a detection still publishes (A0 inform), capped at
 *   severity 1 and marked `CAPPED_LOW_TRUST`, so the brief lists it under
 *   "Treat with care" instead of "Risks".
 * - A RECOMMENDATION resting on LOW or UNKNOWN data is HELD: not proposed.
 *
 * The score is never invented: it is the stored ratio of the signal that
 * limits the figure (numerator ÷ denominator from iq_daily_trust), passed in
 * by the reader. With no ratio, trust is INSUFFICIENT_DATA.
 */
import type { TrustRef } from "./trust";

export type TrustGradeInput = "HIGH" | "MEDIUM" | "LOW" | "UNKNOWN";

export type GateDecision = "PUBLISH" | "PUBLISH_CAPPED" | "HOLD";

export const CAPPED_LOW_TRUST = "CAPPED_LOW_TRUST";

export function trustGate(grade: TrustGradeInput, claim: "DETECTION" | "RECOMMENDATION"): GateDecision {
  const trusted = grade === "HIGH" || grade === "MEDIUM";
  if (trusted) return "PUBLISH";
  return claim === "DETECTION" ? "PUBLISH_CAPPED" : "HOLD";
}

/** A figure's trust on one day, as its reader found it. */
export type FigureTrust = {
  readonly grade: TrustGradeInput;
  /** The signal holding the grade down (or the weakest signal when all are HIGH); null when the metric has no scored signal. */
  readonly signalId: string | null;
  /** That signal's stored ratio for the day; null when it was not scored or its denominator is zero. */
  readonly ratio: { readonly numerator: bigint; readonly denominator: bigint } | null;
  /** When the trust rows were computed, IST ISO timestamp with +05:30. */
  readonly asOf: string;
};

function code(text: string): string {
  return text.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

/** Builds the insight's TrustRef from a figure's trust. `extraReasons` are UPPER_SNAKE codes. */
export function trustRefFor(metricId: string, trust: FigureTrust, extraReasons: readonly string[] = []): TrustRef {
  const reasons = [`GRADE_${trust.grade}`, ...(trust.signalId ? [code(trust.signalId)] : []), ...extraReasons];
  if (trust.grade === "UNKNOWN" || trust.ratio === null || trust.ratio.denominator <= 0n) {
    return { state: "INSUFFICIENT_DATA", reasons: trust.ratio === null && trust.grade !== "UNKNOWN" ? [...reasons, "NO_RATIO"] : reasons };
  }
  const { numerator, denominator } = trust.ratio;
  const clamped = numerator < 0n ? 0n : numerator > denominator ? denominator : numerator;
  const score = Number((clamped * 100n) / denominator);
  return { state: "MEASURED", score, asOf: trust.asOf, metricIds: [metricId], reasons };
}
