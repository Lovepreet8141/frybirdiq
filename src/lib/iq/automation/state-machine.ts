/**
 * The life of one action — the statuses an `iq_actions` row moves through.
 *
 * DESIGN.md §4, with the RELIABILITY review of d250328. The path depends on
 * how the action runs, and that is read from the stored row, never passed in
 * by a caller (`modeOf`):
 *
 * - AUTO (A0; A1 whose row carries an auto policy)
 *     QUEUED → EXECUTING → SUCCEEDED | FAILED
 *     QUEUED → CANCELLED              (the policy was switched off first)
 *     FAILED → QUEUED                 (retry, below MAX_EXECUTION_ATTEMPTS)
 * - APPROVAL (A1 without a policy; every A2)
 *     PENDING_APPROVAL → APPROVED → EXECUTING → SUCCEEDED | FAILED
 *     PENDING_APPROVAL → REJECTED | EXPIRED | SUPERSEDED | CANCELLED
 *     APPROVED → EXPIRED | CANCELLED  (not executed by its execute-by time)
 *     FAILED is terminal: an approval covers one attempt at one moment.
 * - HANDOFF (A3)
 *     HANDOFF → CANCELLED | EXPIRED | SUPERSEDED. Nothing is ever executed.
 *
 * In AUTO and APPROVAL, SUCCEEDED → UNDONE when the catalog gives the kind an
 * undo and its window is still open.
 *
 * Pure: the caller supplies the database's `now` and the policy row as it is
 * now; the repository applies the transition with a compare-and-set on the
 * current status, in the same transaction as those reads.
 */
import type { ActionTier } from "../engine";
import { ACTION_CATALOG, type ActionKind } from "./catalog";
import { A1_AUTO_ALLOWED } from "./policy";

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

/**
 * Statuses in which an action is still in flight. At most one row per
 * (org_id, action_kind, params_hash) may be in one of these — the partial
 * UNIQUE index must use exactly this list.
 */
export const OPEN_ACTION_STATUSES = ["QUEUED", "PENDING_APPROVAL", "APPROVED", "EXECUTING", "HANDOFF"] as const;
export type OpenActionStatus = (typeof OPEN_ACTION_STATUSES)[number];
export type ClosedActionStatus = Exclude<ActionStatus, OpenActionStatus>;

export const EXECUTION_MODES = ["AUTO", "APPROVAL", "HANDOFF"] as const;
export type ExecutionMode = (typeof EXECUTION_MODES)[number];

/** Matches the job runner's maxAttempts (DESIGN-v2-DELTA §3). */
export const MAX_EXECUTION_ATTEMPTS = 3;

/** How long an approved action may wait to start executing; set as `execute_by = approved_at + this`. */
export const EXECUTE_WINDOW_SECONDS = 60 * 60;

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
    APPROVED: ["EXECUTING", "EXPIRED", "CANCELLED"],
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
    HANDOFF: ["CANCELLED", "EXPIRED", "SUPERSEDED"],
  },
};

export const INITIAL_STATUS: { readonly [M in ExecutionMode]: ActionStatus } = {
  AUTO: "QUEUED",
  APPROVAL: "PENDING_APPROVAL",
  HANDOFF: "HANDOFF",
};

/** The modes a tier may run in. A1 is APPROVAL unless its row carries an auto policy. */
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

export type PolicyRef = { readonly id: string; readonly version: number };

/** The iq_actions columns a transition reads. */
export type ActionRow = {
  readonly kind: ActionKind;
  readonly status: ActionStatus;
  /** auto_policy_id + auto_policy_version; set only on an A1 row created under a policy. */
  readonly autoPolicy: PolicyRef | null;
  /** Execution attempts already made. */
  readonly attempts: number;
  /** approval_expires_at: when a PENDING_APPROVAL or HANDOFF row lapses. NOT NULL for those modes. */
  readonly expiresAt: Date | null;
  /** execute_by: set when the row becomes APPROVED. */
  readonly executeBy: Date | null;
  /** When the row reached SUCCEEDED. */
  readonly succeededAt: Date | null;
};

/**
 * How the row runs, from what is stored: the catalog tier and whether an auto
 * policy is recorded. Null when the two contradict (a policy on anything but
 * A1) — such a row may not move at all.
 */
export function modeOf(row: Pick<ActionRow, "kind" | "autoPolicy">): ExecutionMode | null {
  const tier = ACTION_CATALOG[row.kind].tier;
  if (tier === "A1") return row.autoPolicy === null ? "APPROVAL" : "AUTO";
  if (row.autoPolicy !== null) return null;
  return tier === "A0" ? "AUTO" : tier === "A2" ? "APPROVAL" : "HANDOFF";
}

export type TransitionContext = {
  /** Database time. */
  readonly now: Date;
  /**
   * The auto policy row as it is now, read in the same transaction. Required
   * to start or retry an automatic A1 action; absent means refuse.
   */
  readonly currentPolicy?: (PolicyRef & { readonly enabled: boolean }) | null;
  /** Test seam; production always uses A1_AUTO_ALLOWED. */
  readonly allowedAutoKinds?: readonly ActionKind[];
};

export type TransitionRefusal =
  | "ROW_INCONSISTENT"
  | "NOT_IN_TABLE"
  | "APPROVAL_EXPIRED"
  | "EXECUTE_WINDOW_CLOSED"
  | "NOT_YET_DUE"
  | "POLICY_CHANGED"
  | "ATTEMPTS_EXHAUSTED"
  | "NO_UNDO"
  | "UNDO_WINDOW_CLOSED";

export type TransitionResult = { readonly ok: true } | { readonly ok: false; readonly reason: TransitionRefusal };

const refuse = (reason: TransitionRefusal): TransitionResult => ({ ok: false, reason });

const before = (at: Date | null, now: Date) => at !== null && now.getTime() < at.getTime();

export function checkTransition(row: ActionRow, to: ActionStatus, ctx: TransitionContext): TransitionResult {
  const mode = modeOf(row);
  if (mode === null) return refuse("ROW_INCONSISTENT");
  const from = row.status;
  if (!TRANSITIONS[mode][from].includes(to)) return refuse("NOT_IN_TABLE");

  const entry = ACTION_CATALOG[row.kind];
  const { now } = ctx;

  if (from === "PENDING_APPROVAL" && to === "APPROVED" && !before(row.expiresAt, now)) return refuse("APPROVAL_EXPIRED");
  if (from === "APPROVED" && to === "EXECUTING" && !before(row.executeBy, now)) return refuse("EXECUTE_WINDOW_CLOSED");
  if (to === "EXPIRED") {
    const due = from === "APPROVED" ? row.executeBy : row.expiresAt;
    if (before(due, now)) return refuse("NOT_YET_DUE");
  }

  // Starting or retrying an automatic A1 action re-checks its policy (review C3).
  if (mode === "AUTO" && entry.tier === "A1" && (to === "EXECUTING" || to === "QUEUED")) {
    const policy = ctx.currentPolicy;
    const allowed = ctx.allowedAutoKinds ?? A1_AUTO_ALLOWED;
    const holds =
      policy !== undefined &&
      policy !== null &&
      policy.enabled &&
      row.autoPolicy !== null &&
      policy.id === row.autoPolicy.id &&
      policy.version === row.autoPolicy.version &&
      allowed.includes(row.kind);
    if (!holds) return refuse("POLICY_CHANGED");
  }

  if (from === "FAILED" && to === "QUEUED" && row.attempts >= MAX_EXECUTION_ATTEMPTS) return refuse("ATTEMPTS_EXHAUSTED");

  if (from === "SUCCEEDED" && to === "UNDONE") {
    const undo = entry.undo;
    if (undo.kind === "NONE") return refuse("NO_UNDO");
    if (row.succeededAt === null) return refuse("UNDO_WINDOW_CLOSED");
    if (now.getTime() >= row.succeededAt.getTime() + undo.windowSeconds * 1000) return refuse("UNDO_WINDOW_CLOSED");
  }
  return { ok: true };
}
