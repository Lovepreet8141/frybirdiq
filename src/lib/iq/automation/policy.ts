/**
 * Auto policy — whether a new action runs by itself, waits for approval, or
 * is handed to a person.
 *
 * DESIGN-v2-DELTA.md §4. An action runs automatically only if it is A0, or
 * all of these hold:
 *   1. the catalog puts the kind at A1 and outside every money domain;
 *   2. the kind is in `A1_AUTO_ALLOWED`;
 *   3. an `iq_auto_policies` row for the kind is enabled and covers the location;
 *   4. the policy's limits are not used up.
 * Anything else that is A1 waits for approval, exactly like A2.
 *
 * The owner's switch is the `iq_auto_policies` row, written by the
 * `setAutoPolicy` action with a version check. Feature flags play no part.
 *
 * Pure: the repository reads the policy row and today's usage and passes
 * them in.
 */
import { z } from "zod";

import { ACTION_CATALOG, type A1ActionKind, type ActionKind } from "./catalog";
import type { ExecutionMode } from "./state-machine";
import { isMoneyDomain } from "./tiers";

/**
 * A1 kinds the owner has agreed may ever run automatically.
 *
 * Empty until owner decision dec-4. Adding a kind here is a new automatic
 * action class: it needs the owner's sign-off first (brief: escalation).
 */
export const A1_AUTO_ALLOWED: readonly A1ActionKind[] = [];

export const AutoPolicyLimitsSchema = z.strictObject({
  /** Automatic executions of this kind per IST business day, per location. */
  maxPerDay: z.number().int().min(1).max(50),
});
export type AutoPolicyLimits = z.infer<typeof AutoPolicyLimitsSchema>;

/** The part of an `iq_auto_policies` row the decision reads. */
export const AutoPolicySchema = z.strictObject({
  id: z.uuid(),
  actionKind: z.string(),
  /** null covers every location of the org. */
  locationId: z.uuid().nullable(),
  enabled: z.boolean(),
  limits: AutoPolicyLimitsSchema,
  version: z.number().int().min(1),
});
export type AutoPolicy = z.infer<typeof AutoPolicySchema>;

export type AutoPolicyInput = {
  readonly kind: ActionKind;
  readonly locationId: string | null;
  /** The policy row for this kind, or null if none exists. Parsed or not, it is re-checked here. */
  readonly policy: unknown;
  /** Automatic executions of this kind already made today at this location. */
  readonly usedToday: number;
  /** Test seam; production always uses the constant. */
  readonly allowed?: readonly ActionKind[];
};

export type ApprovalReason =
  | "NOT_ALLOWLISTED"
  | "NO_POLICY"
  | "POLICY_INVALID"
  | "POLICY_KIND_MISMATCH"
  | "POLICY_DISABLED"
  | "POLICY_LOCATION_MISMATCH"
  | "DAILY_LIMIT_REACHED";

export type PolicyDecision =
  | { readonly mode: Extract<ExecutionMode, "AUTO">; readonly tier: "A0"; readonly policy: null }
  | {
      readonly mode: Extract<ExecutionMode, "AUTO">;
      readonly tier: "A1";
      readonly policy: { readonly id: string; readonly version: number };
    }
  | { readonly mode: Extract<ExecutionMode, "APPROVAL">; readonly tier: "A1" | "A2"; readonly reason: ApprovalReason | "TIER_A2" }
  | { readonly mode: Extract<ExecutionMode, "HANDOFF">; readonly tier: "A3" }
  | { readonly mode: "REFUSED"; readonly reason: "BLOCKED_BY_DECISION" | "MONEY_DOMAIN_NOT_A3" };

export function evaluateAutoPolicy(input: AutoPolicyInput): PolicyDecision {
  const entry = ACTION_CATALOG[input.kind];

  if (isMoneyDomain(entry.domain) && entry.tier !== "A3") return { mode: "REFUSED", reason: "MONEY_DOMAIN_NOT_A3" };
  if (entry.blockedBy !== null) return { mode: "REFUSED", reason: "BLOCKED_BY_DECISION" };

  switch (entry.tier) {
    case "A0":
      return { mode: "AUTO", tier: "A0", policy: null };
    case "A2":
      return { mode: "APPROVAL", tier: "A2", reason: "TIER_A2" };
    case "A3":
      return { mode: "HANDOFF", tier: "A3" };
    case "A1":
      break;
  }

  const approval = (reason: ApprovalReason): PolicyDecision => ({ mode: "APPROVAL", tier: "A1", reason });

  if (!(input.allowed ?? A1_AUTO_ALLOWED).includes(input.kind)) return approval("NOT_ALLOWLISTED");
  if (input.policy === null || input.policy === undefined) return approval("NO_POLICY");

  const parsed = AutoPolicySchema.safeParse(input.policy);
  if (!parsed.success) return approval("POLICY_INVALID");
  const policy = parsed.data;

  if (policy.actionKind !== input.kind) return approval("POLICY_KIND_MISMATCH");
  if (!policy.enabled) return approval("POLICY_DISABLED");
  if (policy.locationId !== null && policy.locationId !== input.locationId) return approval("POLICY_LOCATION_MISMATCH");
  if (!Number.isInteger(input.usedToday) || input.usedToday < 0 || input.usedToday >= policy.limits.maxPerDay) {
    return approval("DAILY_LIMIT_REACHED");
  }

  return { mode: "AUTO", tier: "A1", policy: { id: policy.id, version: policy.version } };
}
