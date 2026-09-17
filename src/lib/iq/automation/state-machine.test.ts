import { describe, expect, it } from "vitest";

import type { ActionKind } from "./catalog";
import {
  ACTION_STATUSES,
  EXECUTION_MODES,
  INITIAL_STATUS,
  MAX_EXECUTION_ATTEMPTS,
  TRANSITIONS,
  checkTransition,
  isModeAllowedForTier,
  isTerminal,
  type ActionStatus,
  type ExecutionMode,
  type TransitionContext,
} from "./state-machine";

/** Written out independently of the table under test (DESIGN §4). */
const ALLOWED = new Set([
  "AUTO:QUEUED>EXECUTING",
  "AUTO:QUEUED>CANCELLED",
  "AUTO:EXECUTING>SUCCEEDED",
  "AUTO:EXECUTING>FAILED",
  "AUTO:FAILED>QUEUED",
  "AUTO:SUCCEEDED>UNDONE",
  "APPROVAL:PENDING_APPROVAL>APPROVED",
  "APPROVAL:PENDING_APPROVAL>REJECTED",
  "APPROVAL:PENDING_APPROVAL>EXPIRED",
  "APPROVAL:PENDING_APPROVAL>SUPERSEDED",
  "APPROVAL:PENDING_APPROVAL>CANCELLED",
  "APPROVAL:APPROVED>EXECUTING",
  "APPROVAL:EXECUTING>SUCCEEDED",
  "APPROVAL:EXECUTING>FAILED",
  "APPROVAL:SUCCEEDED>UNDONE",
  "HANDOFF:HANDOFF>CANCELLED",
]);

const now = new Date("2026-09-17T10:00:00+05:30");
const hours = (h: number) => new Date(now.getTime() + h * 3600_000);

const KIND_FOR_MODE: Record<ExecutionMode, ActionKind> = {
  AUTO: "inventory.flag_recount",
  APPROVAL: "menu.mark_86",
  HANDOFF: "refund.create",
};

/** A context in which every guard passes, so only the table decides. */
const permissive = (mode: ExecutionMode): TransitionContext => ({
  kind: KIND_FOR_MODE[mode],
  mode,
  attempts: 0,
  approvalExpiresAt: hours(1),
  succeededAt: hours(-1),
  now,
});

const pairs = EXECUTION_MODES.flatMap((mode) =>
  ACTION_STATUSES.flatMap((from) => ACTION_STATUSES.map((to) => [mode, from, to] as const)),
);

describe("transition table (exhaustive)", () => {
  it("covers every mode × from × to", () => {
    expect(pairs).toHaveLength(EXECUTION_MODES.length * ACTION_STATUSES.length ** 2);
  });

  it.each(pairs)("%s: %s → %s", (mode, from, to) => {
    const expected = ALLOWED.has(`${mode}:${from}>${to}`);
    expect(TRANSITIONS[mode][from].includes(to)).toBe(expected);
    const result = checkTransition(from, to, permissive(mode));
    if (from === "PENDING_APPROVAL" && to === "EXPIRED" && expected) {
      expect(result).toEqual({ ok: false, reason: "NOT_YET_EXPIRED" });
    } else {
      expect(result).toEqual(expected ? { ok: true } : { ok: false, reason: "NOT_IN_TABLE" });
    }
  });

  it("has no transition out of a terminal status", () => {
    const terminal: Record<ExecutionMode, ActionStatus[]> = {
      AUTO: ["CANCELLED", "UNDONE"],
      APPROVAL: ["FAILED", "REJECTED", "EXPIRED", "SUPERSEDED", "CANCELLED", "UNDONE"],
      HANDOFF: ["CANCELLED"],
    };
    for (const mode of EXECUTION_MODES) {
      for (const status of terminal[mode]) expect(isTerminal(mode, status)).toBe(true);
    }
    expect(isTerminal("AUTO", "FAILED")).toBe(false);
    expect(isTerminal("APPROVAL", "FAILED")).toBe(true);
    expect(isTerminal("HANDOFF", "HANDOFF")).toBe(false);
  });

  it("starts each mode where the design says", () => {
    expect(INITIAL_STATUS).toEqual({ AUTO: "QUEUED", APPROVAL: "PENDING_APPROVAL", HANDOFF: "HANDOFF" });
    for (const mode of EXECUTION_MODES) expect(TRANSITIONS[mode][INITIAL_STATUS[mode]].length).toBeGreaterThan(0);
  });

  it("never reaches EXECUTING in HANDOFF mode, from anywhere", () => {
    for (const from of ACTION_STATUSES) expect(TRANSITIONS.HANDOFF[from]).not.toContain("EXECUTING");
  });

  it("reaches EXECUTING in APPROVAL mode only from APPROVED", () => {
    const sources = ACTION_STATUSES.filter((from) => TRANSITIONS.APPROVAL[from].includes("EXECUTING"));
    expect(sources).toEqual(["APPROVED"]);
  });
});

describe("tiers and modes", () => {
  it("allows AUTO only for A0 and A1, and HANDOFF only for A3", () => {
    const table = (["A0", "A1", "A2", "A3"] as const).map((tier) =>
      EXECUTION_MODES.filter((mode) => isModeAllowedForTier(tier, mode)),
    );
    expect(table).toEqual([["AUTO"], ["AUTO", "APPROVAL"], ["APPROVAL"], ["HANDOFF"]]);
  });

  it("refuses to run an A2 kind in AUTO or an A3 kind in APPROVAL", () => {
    expect(checkTransition("QUEUED", "EXECUTING", { ...permissive("AUTO"), kind: "menu.mark_86" })).toEqual({
      ok: false,
      reason: "MODE_NOT_ALLOWED_FOR_TIER",
    });
    expect(checkTransition("APPROVED", "EXECUTING", { ...permissive("APPROVAL"), kind: "refund.create" })).toEqual({
      ok: false,
      reason: "MODE_NOT_ALLOWED_FOR_TIER",
    });
  });
});

describe("guards", () => {
  const approval = permissive("APPROVAL");

  it("refuses an approval at or after its expiry, by database time", () => {
    expect(checkTransition("PENDING_APPROVAL", "APPROVED", approval)).toEqual({ ok: true });
    expect(checkTransition("PENDING_APPROVAL", "APPROVED", { ...approval, approvalExpiresAt: now })).toEqual({
      ok: false,
      reason: "APPROVAL_EXPIRED",
    });
    expect(checkTransition("PENDING_APPROVAL", "APPROVED", { ...approval, approvalExpiresAt: null })).toEqual({
      ok: false,
      reason: "APPROVAL_EXPIRED",
    });
  });

  it("expires a request only once its time has come", () => {
    expect(checkTransition("PENDING_APPROVAL", "EXPIRED", { ...approval, approvalExpiresAt: now })).toEqual({ ok: true });
    expect(checkTransition("PENDING_APPROVAL", "EXPIRED", { ...approval, approvalExpiresAt: hours(-1) })).toEqual({
      ok: true,
    });
  });

  it("retries an automatic action only below the attempt limit", () => {
    const auto = permissive("AUTO");
    expect(checkTransition("FAILED", "QUEUED", { ...auto, attempts: MAX_EXECUTION_ATTEMPTS - 1 })).toEqual({ ok: true });
    expect(checkTransition("FAILED", "QUEUED", { ...auto, attempts: MAX_EXECUTION_ATTEMPTS })).toEqual({
      ok: false,
      reason: "ATTEMPTS_EXHAUSTED",
    });
  });

  it("undoes only inside the catalog's window", () => {
    // menu.mark_86: COMPENSATING, 24 hours
    expect(checkTransition("SUCCEEDED", "UNDONE", { ...approval, succeededAt: hours(-23) })).toEqual({ ok: true });
    expect(checkTransition("SUCCEEDED", "UNDONE", { ...approval, succeededAt: hours(-24) })).toEqual({
      ok: false,
      reason: "UNDO_WINDOW_CLOSED",
    });
    expect(checkTransition("SUCCEEDED", "UNDONE", { ...approval, succeededAt: null })).toEqual({
      ok: false,
      reason: "UNDO_WINDOW_CLOSED",
    });
  });

  it("refuses to undo a kind that has no undo", () => {
    expect(checkTransition("SUCCEEDED", "UNDONE", { ...permissive("AUTO"), kind: "brief.publish" })).toEqual({
      ok: false,
      reason: "NO_UNDO",
    });
    expect(checkTransition("SUCCEEDED", "UNDONE", { ...approval, kind: "customer.winback_message" })).toEqual({
      ok: false,
      reason: "NO_UNDO",
    });
  });
});
