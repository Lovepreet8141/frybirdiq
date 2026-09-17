/**
 * The CHECK lists in iq.ts (and so in migration 0034) mirror the engine and
 * automation vocabularies. They are separate literals on purpose — the
 * database constraint is a reviewed migration, not a side effect of editing
 * TypeScript — so this test is what keeps them from drifting apart.
 */
import { describe, expect, it } from "vitest";
import { ACTION_CATALOG, type ActionKind } from "@/lib/iq/automation/catalog";
import {
  ACTION_STATUSES,
  EXECUTION_MODES,
  INITIAL_STATUS,
  OPEN_ACTION_STATUSES,
  TRANSITIONS,
  modeOf,
} from "@/lib/iq/automation/state-machine";
import { ActionTierSchema, CLAIM_TYPES } from "@/lib/iq/engine/claims";
import { SubjectKindSchema } from "@/lib/iq/engine/insight";
import { UNITS } from "@/lib/iq/engine/quantity";
import { JOB_RUN_STATUSES, JOB_TRIGGERS } from "@/lib/jobs/claim-decision";
import {
  IQ_ACTION_STATUSES,
  IQ_CLAIM_TYPES,
  IQ_EXECUTABLE_KINDS,
  IQ_JOB_RUN_STATUSES,
  IQ_JOB_TRIGGERS,
  IQ_MODE_STATUSES,
  IQ_OPEN_ACTION_STATUSES,
  IQ_SUBJECT_KINDS,
  IQ_TIERS,
  IQ_UNITS,
} from "./iq";
import journal from "../../../supabase/migrations/meta/_journal.json";

const sorted = (values: readonly string[]) => [...values].sort();

/** Every status a mode can ever hold: its initial status plus everything reachable from it. */
function reachable(mode: (typeof EXECUTION_MODES)[number]): string[] {
  const seen = new Set<string>([INITIAL_STATUS[mode]]);
  const queue = [INITIAL_STATUS[mode]];
  while (queue.length > 0) {
    const status = queue.shift()!;
    for (const next of TRANSITIONS[mode][status]) {
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  return sorted([...seen]);
}

describe("iq schema vocabularies match the engine and automation code", () => {
  it("claim types, units, subject kinds and tiers", () => {
    expect(sorted(IQ_CLAIM_TYPES)).toEqual(sorted(CLAIM_TYPES));
    expect(sorted(IQ_UNITS)).toEqual(sorted(UNITS));
    expect(sorted(IQ_SUBJECT_KINDS)).toEqual(sorted(SubjectKindSchema.options));
    expect(sorted(IQ_TIERS)).toEqual(sorted(ActionTierSchema.options));
  });

  it("action statuses, open statuses and job run vocabularies", () => {
    expect(sorted(IQ_ACTION_STATUSES)).toEqual(sorted(ACTION_STATUSES));
    // The partial UNIQUE index must use exactly OPEN_ACTION_STATUSES.
    expect(sorted(IQ_OPEN_ACTION_STATUSES)).toEqual(sorted(OPEN_ACTION_STATUSES));
    expect(sorted(IQ_JOB_RUN_STATUSES)).toEqual(sorted(JOB_RUN_STATUSES));
    expect(sorted(IQ_JOB_TRIGGERS)).toEqual(sorted(JOB_TRIGGERS));
  });

  it("every catalog kind below A3 is executable in the database at exactly its tier, and nothing else is", () => {
    const expected = Object.fromEntries(
      Object.entries(ACTION_CATALOG)
        .filter(([, entry]) => entry.tier !== "A3")
        .map(([kind, entry]) => [kind, entry.tier]),
    );
    expect(IQ_EXECUTABLE_KINDS).toEqual(expected);
  });

  it("each mode's CHECK list is exactly the statuses the state machine can reach in that mode", () => {
    for (const mode of EXECUTION_MODES) expect(sorted(IQ_MODE_STATUSES[mode])).toEqual(reachable(mode));
  });

  it("the CHECKs' mode rule (tier + auto_policy_id) agrees with modeOf for every catalog kind", () => {
    // Literal copy of modeIs in iq.ts; a policy on anything but A1 is refused by iq_actions_auto_policy_check.
    const sqlMode = (tier: string, hasPolicy: boolean) => {
      if (hasPolicy && tier !== "A1") return null;
      if (tier === "A0" || (tier === "A1" && hasPolicy)) return "AUTO";
      if (tier === "A2" || tier === "A1") return "APPROVAL";
      return "HANDOFF";
    };
    for (const [kind, entry] of Object.entries(ACTION_CATALOG)) {
      for (const hasPolicy of [false, true]) {
        const autoPolicy = hasPolicy ? { id: "p", version: 1 } : null;
        expect([kind, hasPolicy, sqlMode(entry.tier, hasPolicy)]).toEqual([kind, hasPolicy, modeOf({ kind: kind as ActionKind, autoPolicy })]);
      }
    }
  });
});

describe("migration journal", () => {
  // drizzle-orm's migrator applies only entries whose `when` is newer than the
  // last applied row; a hand-numbered or clock-stamped entry that goes
  // backwards is silently skipped in production.
  it("has strictly increasing `when` and contiguous idx", () => {
    journal.entries.forEach((entry, i) => {
      expect(entry.idx).toBe(i);
      if (i > 0) expect(entry.when).toBeGreaterThan(journal.entries[i - 1]!.when);
    });
  });
});
