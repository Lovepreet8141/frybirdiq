import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { ACTION_CATALOG, ACTION_KINDS, type ActionKind } from "./catalog";
import { A1_AUTO_ALLOWED, evaluateAutoPolicy, type AutoPolicyInput } from "./policy";

const policy = (overrides: Record<string, unknown> = {}) => ({
  id: "7f1c2a3b-4d5e-4f60-8a71-92b3c4d5e6f7",
  actionKind: "inventory.flag_recount",
  locationId: null,
  enabled: true,
  limits: { maxPerDay: 5 },
  version: 3,
  ...overrides,
});

const LOCATION = "0b0c0d0e-1f20-4a31-8b42-c3d4e5f60718";

/** Allowlisted, enabled, under the limit: every A1 condition holds. */
const eligible = (overrides: Partial<AutoPolicyInput> = {}): AutoPolicyInput => ({
  kind: "inventory.flag_recount",
  locationId: LOCATION,
  policy: policy(),
  usedToday: 0,
  allowed: ["inventory.flag_recount"],
  ...overrides,
});

describe("A1_AUTO_ALLOWED", () => {
  it("is empty until the owner decides dec-4", () => {
    expect(A1_AUTO_ALLOWED).toEqual([]);
  });

  it("so with the real allowlist every A1 kind waits for approval, even under an enabled policy", () => {
    const a1 = ACTION_KINDS.filter((k) => ACTION_CATALOG[k].tier === "A1");
    for (const kind of a1) {
      const decision = evaluateAutoPolicy({ ...eligible({ kind, policy: policy({ actionKind: kind }) }), allowed: undefined });
      expect(decision).toEqual({ mode: "APPROVAL", tier: "A1", reason: "NOT_ALLOWLISTED" });
    }
  });
});

describe("evaluateAutoPolicy", () => {
  it("runs A1 automatically when every condition holds, citing the policy version", () => {
    expect(evaluateAutoPolicy(eligible())).toEqual({
      mode: "AUTO",
      tier: "A1",
      policy: { id: "7f1c2a3b-4d5e-4f60-8a71-92b3c4d5e6f7", version: 3 },
    });
    expect(evaluateAutoPolicy(eligible({ policy: policy({ locationId: LOCATION }) })).mode).toBe("AUTO");
  });

  it.each([
    ["NO_POLICY", { policy: null }],
    ["POLICY_INVALID", { policy: policy({ limits: { maxPerDay: 5, maxPaise: "100" } }) }],
    ["POLICY_INVALID", { policy: policy({ limits: { maxPerDay: 0 } }) }],
    ["POLICY_INVALID", { policy: policy({ version: 0 }) }],
    ["POLICY_KIND_MISMATCH", { policy: policy({ actionKind: "prep_list.prefill" }) }],
    ["POLICY_DISABLED", { policy: policy({ enabled: false }) }],
    ["POLICY_LOCATION_MISMATCH", { policy: policy({ locationId: "11111111-2222-4333-8444-555555555555" }) }],
    ["POLICY_LOCATION_MISMATCH", { policy: policy({ locationId: LOCATION }), locationId: null }],
    ["DAILY_LIMIT_REACHED", { usedToday: 5 }],
    ["DAILY_LIMIT_REACHED", { usedToday: -1 }],
    ["DAILY_LIMIT_REACHED", { usedToday: 1.5 }],
    ["NOT_ALLOWLISTED", { allowed: [] }],
  ] as const)("falls back to approval: %s", (reason, overrides) => {
    expect(evaluateAutoPolicy(eligible(overrides as Partial<AutoPolicyInput>))).toEqual({
      mode: "APPROVAL",
      tier: "A1",
      reason,
    });
  });

  it("allows up to the limit and not past it", () => {
    expect(evaluateAutoPolicy(eligible({ usedToday: 4 })).mode).toBe("AUTO");
    expect(evaluateAutoPolicy(eligible({ usedToday: 5 })).mode).toBe("APPROVAL");
  });

  it.each(ACTION_KINDS)("%s: the decision follows the tier, never beyond it", (kind: ActionKind) => {
    const entry = ACTION_CATALOG[kind];
    const decision = evaluateAutoPolicy({
      kind,
      locationId: LOCATION,
      policy: policy({ actionKind: kind }),
      usedToday: 0,
      allowed: [...ACTION_KINDS],
    });
    if (entry.blockedBy !== null) {
      expect(decision).toEqual({ mode: "REFUSED", reason: "BLOCKED_BY_DECISION" });
      return;
    }
    const expected = { A0: "AUTO", A1: "AUTO", A2: "APPROVAL", A3: "HANDOFF" }[entry.tier];
    expect(decision.mode).toBe(expected);
  });

  it("never lets a policy or the allowlist lift an A2 or A3 kind", () => {
    const everything = { policy: policy({ actionKind: "menu.mark_86" }), allowed: [...ACTION_KINDS] };
    expect(evaluateAutoPolicy(eligible({ kind: "menu.mark_86", ...everything }))).toEqual({
      mode: "APPROVAL",
      tier: "A2",
      reason: "TIER_A2",
    });
    expect(evaluateAutoPolicy(eligible({ kind: "refund.create", ...everything }))).toEqual({ mode: "HANDOFF", tier: "A3" });
    expect(evaluateAutoPolicy(eligible({ kind: "purchase_order.send", ...everything }))).toEqual({
      mode: "HANDOFF",
      tier: "A3",
    });
  });
});

describe("no IQ code reads feature flags (DESIGN-v2-DELTA §4)", () => {
  it("finds no feature_flags reference under src/lib/iq", () => {
    const root = fileURLToPath(new URL("..", import.meta.url));
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else if (/\.tsx?$/.test(name) && !path.endsWith("policy.test.ts")) {
          if (/feature_?flags/i.test(readFileSync(path, "utf8"))) offenders.push(path);
        }
      }
    };
    walk(root);
    expect(offenders).toEqual([]);
  });
});
