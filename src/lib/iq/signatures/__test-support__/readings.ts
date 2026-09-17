/** SignatureReading fixtures: Observed counts minted the way the repository mints them. */
import { observed } from "@/lib/iq/engine/observed-factory";

import { PRE_REFUND_SIGNATURES, type SignatureReading, type SignatureRuleId } from "../pre-refund";

export const ORG = "3f0c8a52-7c1e-4b6a-9d7e-2a1b3c4d5e6f";

export function reading(ruleId: SignatureRuleId, count: number): SignatureReading {
  return { ruleId, status: "EVALUATED", count: observed({ unit: "count", value: count }), threshold: observed({ unit: "count", value: 0 }) };
}

/** Every rule evaluated, with the given counts and 0 elsewhere. */
export function allReadings(counts: Partial<Record<SignatureRuleId, number>> = {}): SignatureReading[] {
  return PRE_REFUND_SIGNATURES.map((rule) => reading(rule.ruleId, counts[rule.ruleId] ?? 0));
}
