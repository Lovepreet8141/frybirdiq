/**
 * Money crash signatures, before the refund release (IQ-2 S5; DESIGN.md §1b
 * and Revision 2 R2.7).
 *
 * Each rule counts a row state that correct code cannot leave behind: a
 * second capture on one order, a refunded payment with no refund row, a
 * refund whose order and loyalty follow-up never finished, an order left half
 * written, money taken on a closed order, a withIdempotency claim abandoned
 * mid-work, a webhook that failed. A count above zero is a DETECTION; zero
 * clears the rule's ACTIVE finding.
 *
 * Pure: the repository (`src/lib/repositories/iq-signatures.ts`) runs the
 * read-only queries and returns Observed counts; this file only decides.
 * Counts only. No order ids, amounts or claim keys reach an insight (R2.2).
 */
import { magnitudeOf, type Observed } from "@/lib/iq/engine";

/** Bump when a rule's definition changes; part of every evidence hash. */
export const SIGNATURE_RULE_VERSION = 1;

/**
 * The pre-refund-release rules. `minAgeMinutes` is how long a row must have
 * been in the state before it counts (5 min for every state rule, R2.7; the
 * P1 thresholds where they are longer). The post-release rules
 * (sig.refund_reserved_stale and the rest of §1b's second table) read
 * migration 0038's refund status and are S6.
 */
export const PRE_REFUND_SIGNATURES = [
  { ruleId: "sig.double_capture", severity: 3, minAgeMinutes: 5 },
  { ruleId: "sig.refund_unrecorded", severity: 3, minAgeMinutes: 5 },
  { ruleId: "sig.refund_followup_lost", severity: 2, minAgeMinutes: 10 },
  { ruleId: "sig.half_order", severity: 2, minAgeMinutes: 10 },
  { ruleId: "sig.capture_on_terminal", severity: 3, minAgeMinutes: 5 },
  { ruleId: "sig.claim_stuck", severity: 2, minAgeMinutes: 15 },
  { ruleId: "sig.webhook_failed", severity: 2, minAgeMinutes: 60 },
] as const;

export type SignatureRuleId = (typeof PRE_REFUND_SIGNATURES)[number]["ruleId"];
export type SignatureSeverity = 1 | 2 | 3;

/** R2.7 P2: the withIdempotency operations whose abandoned claims are money signatures. */
export const CLAIM_STUCK_OPERATIONS = ["placeOrder", "placeCounterOrder", "recordPayment", "refund_payment"] as const;

/**
 * What the repository read for one rule: a count, with the zero it is judged
 * against (both Observed, from stored rows), or a timeout. A rule that timed
 * out did not evaluate: its ACTIVE finding is neither refreshed nor expired.
 */
export type SignatureReading =
  | { readonly ruleId: SignatureRuleId; readonly status: "EVALUATED"; readonly count: Observed; readonly threshold: Observed }
  | { readonly ruleId: SignatureRuleId; readonly status: "RULE_TIMEOUT" };

export type SignatureOutcome =
  | {
      readonly ruleId: SignatureRuleId;
      readonly status: "FIRED";
      readonly dedupeKey: string;
      readonly severity: SignatureSeverity;
      readonly count: Observed;
      readonly threshold: Observed;
    }
  | { readonly ruleId: SignatureRuleId; readonly status: "CLEAR"; readonly dedupeKey: string }
  | { readonly ruleId: SignatureRuleId; readonly status: "NOT_EVALUATED"; readonly dedupeKey: string; readonly reason: "RULE_TIMEOUT" };

/** One stable key per rule (R2.7): a signature is a standing condition, not an event per run. */
export function signatureDedupeKey(ruleId: SignatureRuleId): string {
  return `sig:${ruleId}`;
}

export function severityOf(ruleId: SignatureRuleId): SignatureSeverity {
  const rule = PRE_REFUND_SIGNATURES.find((r) => r.ruleId === ruleId);
  if (!rule) throw new RangeError(`signatures: unknown rule ${ruleId}`);
  return rule.severity;
}

/**
 * Decides every rule from its reading. A rule with no reading is treated as
 * not evaluated, never as clear, so a partial read can never expire a finding.
 */
export function evaluateSignatures(readings: readonly SignatureReading[]): {
  readonly outcomes: readonly SignatureOutcome[];
  readonly summary: Readonly<Record<string, number>>;
} {
  const summary: Record<string, number> = { rules_fired: 0, rules_clear: 0, rule_timeout: 0 };
  const outcomes = PRE_REFUND_SIGNATURES.map((rule): SignatureOutcome => {
    const dedupeKey = signatureDedupeKey(rule.ruleId);
    const reading = readings.find((r) => r.ruleId === rule.ruleId);
    if (!reading || reading.status === "RULE_TIMEOUT") {
      summary.rule_timeout = (summary.rule_timeout ?? 0) + 1;
      return { ruleId: rule.ruleId, status: "NOT_EVALUATED", dedupeKey, reason: "RULE_TIMEOUT" };
    }
    if (magnitudeOf(reading.count) > magnitudeOf(reading.threshold)) {
      summary.rules_fired = (summary.rules_fired ?? 0) + 1;
      return { ruleId: rule.ruleId, status: "FIRED", dedupeKey, severity: rule.severity, count: reading.count, threshold: reading.threshold };
    }
    summary.rules_clear = (summary.rules_clear ?? 0) + 1;
    return { ruleId: rule.ruleId, status: "CLEAR", dedupeKey };
  });
  return { outcomes, summary };
}
