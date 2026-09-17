import { describe, expect, it } from "vitest";

import { ACTION_CATALOG, ACTION_KINDS, type ActionKind } from "./catalog";
import {
  ACTION_STATUSES,
  EXECUTION_MODES,
  INITIAL_STATUS,
  MAX_EXECUTION_ATTEMPTS,
  OPEN_ACTION_STATUSES,
  TRANSITIONS,
  checkTransition,
  isModeAllowedForTier,
  isTerminal,
  modeOf,
  type ActionRow,
  type ActionStatus,
  type ExecutionMode,
  type TransitionContext,
} from "./state-machine";

/** Written out independently of the table under test (DESIGN §4 + RELIABILITY review). */
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
  "APPROVAL:APPROVED>EXPIRED",
  "APPROVAL:APPROVED>CANCELLED",
  "APPROVAL:EXECUTING>SUCCEEDED",
  "APPROVAL:EXECUTING>FAILED",
  "APPROVAL:SUCCEEDED>UNDONE",
  "HANDOFF:HANDOFF>CANCELLED",
  "HANDOFF:HANDOFF>EXPIRED",
  "HANDOFF:HANDOFF>SUPERSEDED",
]);

const now = new Date("2026-09-17T10:00:00+05:30");
const hours = (h: number) => new Date(now.getTime() + h * 3600_000);
const POLICY = { id: "7f1c2a3b-4d5e-4f60-8a71-92b3c4d5e6f7", version: 2 };

const KIND_FOR_MODE: Record<ExecutionMode, ActionKind> = {
  AUTO: "inventory.flag_recount",
  APPROVAL: "menu.mark_86",
  HANDOFF: "refund.create",
};

/** A row and context in which every guard passes, so only the table decides. */
const permissive = (mode: ExecutionMode, status: ActionStatus): [ActionRow, TransitionContext] => [
  {
    kind: KIND_FOR_MODE[mode],
    status,
    autoPolicy: mode === "AUTO" ? POLICY : null,
    attempts: 0,
    expiresAt: hours(1),
    executeBy: hours(1),
    succeededAt: hours(-1),
  },
  { now, currentPolicy: { ...POLICY, enabled: true }, allowedAutoKinds: [KIND_FOR_MODE.AUTO] },
];

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
    const [row, ctx] = permissive(mode, from);
    const result = checkTransition(row, to, ctx);
    if (expected && to === "EXPIRED") {
      expect(result).toEqual({ ok: false, reason: "NOT_YET_DUE" });
    } else {
      expect(result).toEqual(expected ? { ok: true } : { ok: false, reason: "NOT_IN_TABLE" });
    }
  });

  it("leaves no dead end: anything waiting on a person or an executor can expire or fail (B4)", () => {
    const stuck: string[] = [];
    for (const mode of EXECUTION_MODES) {
      for (const status of OPEN_ACTION_STATUSES) {
        const exits = TRANSITIONS[mode][status];
        if (exits.length === 0) continue; // not a status of this mode
        const timeExit = mode === "AUTO" || status === "EXECUTING" ? "FAILED" : "EXPIRED";
        if (status === "QUEUED") continue; // the runner picks QUEUED up itself
        if (!exits.includes(timeExit)) stuck.push(`${mode}:${status}`);
      }
    }
    // Before the fix: ["APPROVAL:APPROVED", "HANDOFF:HANDOFF"].
    expect(stuck).toEqual([]);
  });

  it("has no transition out of a terminal status", () => {
    const terminal: Record<ExecutionMode, ActionStatus[]> = {
      AUTO: ["CANCELLED", "UNDONE"],
      APPROVAL: ["FAILED", "REJECTED", "EXPIRED", "SUPERSEDED", "CANCELLED", "UNDONE"],
      HANDOFF: ["CANCELLED", "EXPIRED", "SUPERSEDED"],
    };
    for (const mode of EXECUTION_MODES) {
      for (const status of terminal[mode]) expect(isTerminal(mode, status)).toBe(true);
    }
    expect(isTerminal("AUTO", "FAILED")).toBe(false);
    expect(isTerminal("APPROVAL", "APPROVED")).toBe(false);
    expect(isTerminal("HANDOFF", "HANDOFF")).toBe(false);
  });

  it("starts each mode where the design says", () => {
    expect(INITIAL_STATUS).toEqual({ AUTO: "QUEUED", APPROVAL: "PENDING_APPROVAL", HANDOFF: "HANDOFF" });
  });

  it("never reaches EXECUTING in HANDOFF mode, and in APPROVAL only from APPROVED", () => {
    for (const from of ACTION_STATUSES) expect(TRANSITIONS.HANDOFF[from]).not.toContain("EXECUTING");
    expect(ACTION_STATUSES.filter((from) => TRANSITIONS.APPROVAL[from].includes("EXECUTING"))).toEqual(["APPROVED"]);
  });

  it("names the open statuses the partial UNIQUE index must cover", () => {
    expect([...OPEN_ACTION_STATUSES]).toEqual(["QUEUED", "PENDING_APPROVAL", "APPROVED", "EXECUTING", "HANDOFF"]);
    // Every initial status is open, so a fresh row always blocks its duplicate.
    for (const mode of EXECUTION_MODES) expect(OPEN_ACTION_STATUSES).toContain(INITIAL_STATUS[mode]);
  });
});

describe("mode comes from the stored row (B1)", () => {
  it.each(ACTION_KINDS)("%s: mode follows tier and the stored auto policy", (kind) => {
    const tier = ACTION_CATALOG[kind].tier;
    const withoutPolicy = modeOf({ kind, autoPolicy: null });
    const withPolicy = modeOf({ kind, autoPolicy: POLICY });
    expect(withoutPolicy).toBe({ A0: "AUTO", A1: "APPROVAL", A2: "APPROVAL", A3: "HANDOFF" }[tier]);
    expect(withPolicy).toBe(tier === "A1" ? "AUTO" : null);
    if (withoutPolicy !== null) expect(isModeAllowedForTier(tier, withoutPolicy)).toBe(true);
  });

  it("refuses to re-queue a FAILED A1 action that came through approval", () => {
    const [row, ctx] = permissive("AUTO", "FAILED");
    expect(checkTransition({ ...row, autoPolicy: null }, "QUEUED", ctx)).toEqual({ ok: false, reason: "NOT_IN_TABLE" });
    expect(checkTransition(row, "QUEUED", ctx)).toEqual({ ok: true });
  });

  it("refuses any move on a row whose policy contradicts its tier", () => {
    const [row, ctx] = permissive("APPROVAL", "PENDING_APPROVAL");
    expect(checkTransition({ ...row, autoPolicy: POLICY }, "APPROVED", ctx)).toEqual({ ok: false, reason: "ROW_INCONSISTENT" });
    const [handoff] = permissive("HANDOFF", "HANDOFF");
    expect(checkTransition({ ...handoff, autoPolicy: POLICY }, "CANCELLED", ctx)).toEqual({
      ok: false,
      reason: "ROW_INCONSISTENT",
    });
  });
});

describe("guards", () => {
  it("refuses an approval at or after its expiry, by database time", () => {
    const [row, ctx] = permissive("APPROVAL", "PENDING_APPROVAL");
    expect(checkTransition(row, "APPROVED", ctx)).toEqual({ ok: true });
    for (const expiresAt of [now, hours(-1), null]) {
      expect(checkTransition({ ...row, expiresAt }, "APPROVED", ctx)).toEqual({ ok: false, reason: "APPROVAL_EXPIRED" });
    }
  });

  it("executes an approved action only before its execute-by time, then lets it expire (B4)", () => {
    const [row, ctx] = permissive("APPROVAL", "APPROVED");
    expect(checkTransition(row, "EXECUTING", ctx)).toEqual({ ok: true });
    expect(checkTransition(row, "EXPIRED", ctx)).toEqual({ ok: false, reason: "NOT_YET_DUE" });
    for (const executeBy of [now, hours(-1), null]) {
      expect(checkTransition({ ...row, executeBy }, "EXECUTING", ctx)).toEqual({ ok: false, reason: "EXECUTE_WINDOW_CLOSED" });
      expect(checkTransition({ ...row, executeBy }, "EXPIRED", ctx)).toEqual({ ok: true });
    }
    expect(checkTransition(row, "CANCELLED", ctx)).toEqual({ ok: true });
  });

  it("expires a pending request or a handoff only once due (B4)", () => {
    for (const mode of ["APPROVAL", "HANDOFF"] as const) {
      const [row, ctx] = permissive(mode, INITIAL_STATUS[mode]);
      expect(checkTransition({ ...row, expiresAt: now }, "EXPIRED", ctx)).toEqual({ ok: true });
      expect(checkTransition({ ...row, expiresAt: hours(1) }, "EXPIRED", ctx)).toEqual({ ok: false, reason: "NOT_YET_DUE" });
    }
    const [handoff, ctx] = permissive("HANDOFF", "HANDOFF");
    expect(checkTransition(handoff, "SUPERSEDED", ctx)).toEqual({ ok: true });
  });

  it("re-checks the auto policy before starting or retrying an automatic A1 action (C3)", () => {
    for (const [from, to] of [
      ["QUEUED", "EXECUTING"],
      ["FAILED", "QUEUED"],
    ] as const) {
      const [row, ctx] = permissive("AUTO", from);
      expect(checkTransition(row, to, ctx)).toEqual({ ok: true });
      for (const change of [
        { currentPolicy: undefined },
        { currentPolicy: null },
        { currentPolicy: { ...POLICY, enabled: false } },
        { currentPolicy: { ...POLICY, version: 3, enabled: true } },
        { currentPolicy: { id: "11111111-2222-4333-8444-555555555555", version: 2, enabled: true } },
        { allowedAutoKinds: undefined }, // the real allowlist is empty until dec-4
      ]) {
        expect(checkTransition(row, to, { ...ctx, ...change })).toEqual({ ok: false, reason: "POLICY_CHANGED" });
      }
    }
  });

  it("needs no policy for A0, and lets a queued A1 be cancelled after its policy is switched off", () => {
    const row: ActionRow = { ...permissive("AUTO", "QUEUED")[0], kind: "brief.publish", autoPolicy: null };
    expect(checkTransition(row, "EXECUTING", { now })).toEqual({ ok: true });
    const [a1, ctx] = permissive("AUTO", "QUEUED");
    expect(checkTransition(a1, "CANCELLED", { ...ctx, currentPolicy: { ...POLICY, enabled: false } })).toEqual({ ok: true });
  });

  it("retries an automatic action only below the attempt limit", () => {
    const [row, ctx] = permissive("AUTO", "FAILED");
    expect(checkTransition({ ...row, attempts: MAX_EXECUTION_ATTEMPTS - 1 }, "QUEUED", ctx)).toEqual({ ok: true });
    expect(checkTransition({ ...row, attempts: MAX_EXECUTION_ATTEMPTS }, "QUEUED", ctx)).toEqual({
      ok: false,
      reason: "ATTEMPTS_EXHAUSTED",
    });
  });

  it("undoes only inside the catalog's window", () => {
    const [row, ctx] = permissive("APPROVAL", "SUCCEEDED"); // menu.mark_86: 24 hours
    expect(checkTransition({ ...row, succeededAt: hours(-23) }, "UNDONE", ctx)).toEqual({ ok: true });
    for (const succeededAt of [hours(-24), null]) {
      expect(checkTransition({ ...row, succeededAt }, "UNDONE", ctx)).toEqual({ ok: false, reason: "UNDO_WINDOW_CLOSED" });
    }
    expect(checkTransition({ ...row, kind: "customer.winback_message" }, "UNDONE", ctx)).toEqual({ ok: false, reason: "NO_UNDO" });
  });
});
