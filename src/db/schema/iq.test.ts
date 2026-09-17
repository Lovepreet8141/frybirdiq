/**
 * The CHECK lists in iq.ts (and so in migration 0034) mirror the engine and
 * automation vocabularies. They are separate literals on purpose — the
 * database constraint is a reviewed migration, not a side effect of editing
 * TypeScript — so this test is what keeps them from drifting apart.
 */
import { describe, expect, it } from "vitest";
import { ACTION_CATALOG } from "@/lib/iq/automation/catalog";
import { ACTION_STATUSES, EXECUTION_MODES, INITIAL_STATUS, MODES_FOR_TIER, TRANSITIONS } from "@/lib/iq/automation/state-machine";
import { ActionTierSchema, CLAIM_TYPES } from "@/lib/iq/engine/claims";
import { SubjectKindSchema } from "@/lib/iq/engine/insight";
import { UNITS } from "@/lib/iq/engine/quantity";
import {
  IQ_ACTION_STATUSES,
  IQ_CLAIM_TYPES,
  IQ_EXECUTABLE_KINDS,
  IQ_EXECUTION_MODES,
  IQ_MODE_STATUSES,
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

  // The database admits RELIABILITY's B4/C5 statuses ahead of the state
  // machine (iq0-s2b), so these are subset checks: every status the code can
  // produce must be storable. Tighten to equality once the pure side lands.
  it("every action status and execution mode the code uses is storable", () => {
    expect(IQ_ACTION_STATUSES).toEqual(expect.arrayContaining([...ACTION_STATUSES]));
    expect(sorted(IQ_EXECUTION_MODES)).toEqual(sorted(EXECUTION_MODES));
  });

  it("every catalog kind below A3 is executable in the database at exactly its tier, and nothing else is", () => {
    const expected = Object.fromEntries(
      Object.entries(ACTION_CATALOG)
        .filter(([, entry]) => entry.tier !== "A3")
        .map(([kind, entry]) => [kind, entry.tier]),
    );
    expect(IQ_EXECUTABLE_KINDS).toEqual(expected);
  });

  it("the mode/status CHECK admits every status the state machine can reach in that mode", () => {
    for (const mode of EXECUTION_MODES) expect(IQ_MODE_STATUSES[mode]).toEqual(expect.arrayContaining(reachable(mode)));
  });

  it("every mode's statuses are known action statuses", () => {
    for (const mode of EXECUTION_MODES) expect(IQ_ACTION_STATUSES).toEqual(expect.arrayContaining([...IQ_MODE_STATUSES[mode]]));
  });

  it("the tier/mode CHECK in 0034 matches MODES_FOR_TIER", () => {
    const check = { A0: ["AUTO"], A1: ["AUTO", "APPROVAL"], A2: ["APPROVAL"], A3: ["HANDOFF"] } as const;
    for (const tier of IQ_TIERS) expect(sorted(check[tier])).toEqual(sorted(MODES_FOR_TIER[tier]));
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
