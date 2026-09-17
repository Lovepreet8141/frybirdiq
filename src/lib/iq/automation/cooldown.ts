/**
 * Cooldown — when the engine may propose the same action again.
 *
 * DESIGN-v2-DELTA.md §4 with the RELIABILITY review of d250328. "The same
 * action" is the same org, action kind and params hash. The repository reads
 * two things and passes both:
 *
 * - `open`: any row still in flight (OPEN_ACTION_STATUSES). One exists → a
 *   new proposal would be a duplicate, however old the closed rows are.
 * - `latestClosed`: otherwise, the most recently closed row.
 *
 * Cooldown after a closed row:
 * - REJECTED, UNDONE, CANCELLED: a person said no (CANCELLED is also the only
 *   way to dismiss an A3 handoff). 7 days.
 * - EXPIRED: nobody looked in time. 1 day.
 * - FAILED: the executor could not do it. 1 day, so a failing action does not
 *   ask the owner again on every run.
 * - SUCCEEDED, SUPERSEDED: none; whether it is worth doing again is the rule's call.
 *
 * Reading is not enough on its own: two runs can both read nothing. The
 * partial UNIQUE index on open rows is what finally refuses the second insert.
 */
import type { ClosedActionStatus, OpenActionStatus } from "./state-machine";

const DAY_MS = 24 * 60 * 60 * 1000;

export const COOLDOWN_MS = {
  dismissed: 7 * DAY_MS,
  expired: 1 * DAY_MS,
  failed: 1 * DAY_MS,
} as const;

export type ProposalHistory = {
  readonly open: { readonly status: OpenActionStatus } | null;
  readonly latestClosed: { readonly status: ClosedActionStatus; readonly decidedAt: Date } | null;
};

export type CooldownReason = "DISMISSED_COOLDOWN" | "EXPIRED_COOLDOWN" | "FAILED_COOLDOWN";

export type ProposalCheck =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: "OPEN_DUPLICATE" }
  | { readonly ok: false; readonly reason: CooldownReason; readonly until: Date };

const COOLDOWN: { readonly [S in ClosedActionStatus]: { reason: CooldownReason; ms: number } | null } = {
  REJECTED: { reason: "DISMISSED_COOLDOWN", ms: COOLDOWN_MS.dismissed },
  UNDONE: { reason: "DISMISSED_COOLDOWN", ms: COOLDOWN_MS.dismissed },
  CANCELLED: { reason: "DISMISSED_COOLDOWN", ms: COOLDOWN_MS.dismissed },
  EXPIRED: { reason: "EXPIRED_COOLDOWN", ms: COOLDOWN_MS.expired },
  FAILED: { reason: "FAILED_COOLDOWN", ms: COOLDOWN_MS.failed },
  SUCCEEDED: null,
  SUPERSEDED: null,
};

export function mayPropose(history: ProposalHistory, now: Date): ProposalCheck {
  if (history.open !== null) return { ok: false, reason: "OPEN_DUPLICATE" };
  const latest = history.latestClosed;
  if (latest === null) return { ok: true };

  const cooldown = COOLDOWN[latest.status];
  if (cooldown === null) return { ok: true };

  const until = new Date(latest.decidedAt.getTime() + cooldown.ms);
  return now.getTime() < until.getTime() ? { ok: false, reason: cooldown.reason, until } : { ok: true };
}
