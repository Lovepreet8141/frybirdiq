/**
 * The life of one action — the statuses an `iq_actions` row moves through.
 *
 * DESIGN.md §4. The path depends on how the action runs, which is decided
 * once, when the action is created (`policy.ts`):
 *
 * - AUTO (A0, and A1 under an enabled auto policy)
 *     QUEUED → EXECUTING → SUCCEEDED | FAILED
 *     QUEUED → CANCELLED              (the policy was switched off first)
 *     FAILED → QUEUED                 (retry, below MAX_EXECUTION_ATTEMPTS)
 * - APPROVAL (A1 without a policy, and every A2)
 *     PENDING_APPROVAL → APPROVED → EXECUTING → SUCCEEDED | FAILED
 *     PENDING_APPROVAL → REJECTED | EXPIRED | SUPERSEDED | CANCELLED
 *     FAILED is terminal: an approval covers one attempt at one moment.
 * - HANDOFF (A3)
 *     HANDOFF → CANCELLED. Nothing is ever executed.
 *
 * In AUTO and APPROVAL, SUCCEEDED → UNDONE when the catalog gives the kind an
 * undo and its window is still open.
 *
 * Pure: the caller supplies the database's `now`, and the repository applies
 * the transition with a compare-and-set on the current status.
 */
import type { ActionTier } from "../engine";
import { ACTION_CATALOG, type ActionKind } from "./catalog";

export const ACTION_STATUSES = [
  "QUEUED",
  "PENDING_APPROVAL",
  "APPROVED",
  "EXECUTING",
  "SUCCEEDED",
  "FAILED",
  "REJECTED",
  "EXPIRED",
  "SUPERSEDED",
  "CANCELLED",
  "UNDONE",
  "HANDOFF",
] as const;
export type ActionStatus = (typeof ACTION_STATUSES)[number];

export const EXECUTION_MODES = ["AUTO", "APPROVAL", "HANDOFF"] as const;
export type ExecutionMode = (typeof EXECUTION_MODES)[number];

/** Matches the job runner's maxAttempts (DESIGN-v2-DELTA §3). */
export const MAX_EXECUTION_ATTEMPTS = 3;

type TransitionTable = { readonly [S in ActionStatus]: readonly ActionStatus[] };

const NONE: readonly ActionStatus[] = [];

export const TRANSITIONS: { readonly [M in ExecutionMode]: TransitionTable } = {
  AUTO: {
    QUEUED: ["EXECUTING", "CANCELLED"],
    PENDING_APPROVAL: NONE,
    APPROVED: NONE,
    EXECUTING: ["SUCCEEDED", "FAILED"],
    SUCCEEDED: ["UNDONE"],
    FAILED: ["QUEUED"],
    REJECTED: NONE,
    EXPIRED: NONE,
    SUPERSEDED: NONE,
    CANCELLED: NONE,
    UNDONE: NONE,
    HANDOFF: NONE,
  },
  APPROVAL: {
    QUEUED: NONE,
    PENDING_APPROVAL: ["APPROVED", "REJECTED", "EXPIRED", "SUPERSEDED", "CANCELLED"],
    APPROVED: ["EXECUTING"],
    EXECUTING: ["SUCCEEDED", "FAILED"],
    SUCCEEDED: ["UNDONE"],
    FAILED: NONE,
    REJECTED: NONE,
    EXPIRED: NONE,
    SUPERSEDED: NONE,
    CANCELLED: NONE,
    UNDONE: NONE,
    HANDOFF: NONE,
  },
  HANDOFF: {
    QUEUED: NONE,
    PENDING_APPROVAL: NONE,
    APPROVED: NONE,
    EXECUTING: NONE,
    SUCCEEDED: NONE,
    FAILED: NONE,
    REJECTED: NONE,
    EXPIRED: NONE,
    SUPERSEDED: NONE,
    CANCELLED: NONE,
    UNDONE: NONE,
    HANDOFF: ["CANCELLED"],
  },
};

export const INITIAL_STATUS: { readonly [M in ExecutionMode]: ActionStatus } = {
  AUTO: "QUEUED",
  APPROVAL: "PENDING_APPROVAL",
  HANDOFF: "HANDOFF",
};

/** The modes a tier may run in. A1 is APPROVAL unless a policy grants AUTO. */
export const MODES_FOR_TIER: { readonly [T in ActionTier]: readonly ExecutionMode[] } = {
  A0: ["AUTO"],
  A1: ["AUTO", "APPROVAL"],
  A2: ["APPROVAL"],
  A3: ["HANDOFF"],
};

export function isModeAllowedForTier(tier: ActionTier, mode: ExecutionMode): boolean {
  return MODES_FOR_TIER[tier].includes(mode);
}

export function isTerminal(mode: ExecutionMode, status: ActionStatus): boolean {
  return TRANSITIONS[mode][status].length === 0;
}

/** Everything a guarded transition needs to know about the row. */
export type TransitionContext = {
  readonly kind: ActionKind;
  readonly mode: ExecutionMode;
  /** Execution attempts already made. */
  readonly attempts: number;
  /** When the approval request lapses; APPROVAL mode only. */
  readonly approvalExpiresAt: Date | null;
  /** When the action reached SUCCEEDED. */
  readonly succeededAt: Date | null;
  /** Database time. */
  readonly now: Date;
};

export type TransitionRefusal =
  | "MODE_NOT_ALLOWED_FOR_TIER"
  | "NOT_IN_TABLE"
  | "APPROVAL_EXPIRED"
  | "NOT_YET_EXPIRED"
  | "ATTEMPTS_EXHAUSTED"
  | "NO_UNDO"
  | "UNDO_WINDOW_CLOSED";

export type TransitionResult = { readonly ok: true } | { readonly ok: false; readonly reason: TransitionRefusal };

const refuse = (reason: TransitionRefusal): TransitionResult => ({ ok: false, reason });

export function checkTransition(from: ActionStatus, to: ActionStatus, ctx: TransitionContext): TransitionResult {
  const entry = ACTION_CATALOG[ctx.kind];
  if (!isModeAllowedForTier(entry.tier, ctx.mode)) return refuse("MODE_NOT_ALLOWED_FOR_TIER");
  if (!TRANSITIONS[ctx.mode][from].includes(to)) return refuse("NOT_IN_TABLE");

  if (from === "PENDING_APPROVAL" && to === "APPROVED") {
    if (ctx.approvalExpiresAt === null || ctx.approvalExpiresAt.getTime() <= ctx.now.getTime()) {
      return refuse("APPROVAL_EXPIRED");
    }
  }
  if (from === "PENDING_APPROVAL" && to === "EXPIRED") {
    if (ctx.approvalExpiresAt !== null && ctx.approvalExpiresAt.getTime() > ctx.now.getTime()) {
      return refuse("NOT_YET_EXPIRED");
    }
  }
  if (from === "FAILED" && to === "QUEUED" && ctx.attempts >= MAX_EXECUTION_ATTEMPTS) {
    return refuse("ATTEMPTS_EXHAUSTED");
  }
  if (from === "SUCCEEDED" && to === "UNDONE") {
    const undo = entry.undo;
    if (undo.kind === "NONE") return refuse("NO_UNDO");
    if (ctx.succeededAt === null) return refuse("UNDO_WINDOW_CLOSED");
    const closesAt = ctx.succeededAt.getTime() + undo.windowSeconds * 1000;
    if (ctx.now.getTime() >= closesAt) return refuse("UNDO_WINDOW_CLOSED");
  }
  return { ok: true };
}
