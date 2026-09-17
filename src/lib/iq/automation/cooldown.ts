/**
 * Cooldown — when the engine may propose the same action again.
 *
 * DESIGN-v2-DELTA.md §4: dismissed 7 days, expired 1 day. "The same action"
 * is the same org, action kind and params hash; the repository reads the
 * latest decided row through the (org_id, action_kind, params_hash,
 * decided_at desc) index and passes it in.
 *
 * - REJECTED or UNDONE: a person said no. Quiet for 7 days.
 * - EXPIRED: nobody looked in time. It may come back after 1 day.
 * - still open (queued, pending, approved, executing, handed off): proposing
 *   it again would be a duplicate.
 * - anything else (succeeded, failed, superseded, cancelled): no cooldown;
 *   whether it is still worth doing is the rule's call, not this one's.
 */
import type { ActionStatus } from "./state-machine";

const DAY_MS = 24 * 60 * 60 * 1000;

export const COOLDOWN_MS = {
  dismissed: 7 * DAY_MS,
  expired: 1 * DAY_MS,
} as const;

const OPEN: ReadonlySet<ActionStatus> = new Set(["QUEUED", "PENDING_APPROVAL", "APPROVED", "EXECUTING", "HANDOFF"]);

export type LatestAction = {
  readonly status: ActionStatus;
  /** When the row reached its current status. */
  readonly decidedAt: Date;
};

export type ProposalCheck =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: "OPEN_DUPLICATE" }
  | { readonly ok: false; readonly reason: "DISMISSED_COOLDOWN" | "EXPIRED_COOLDOWN"; readonly until: Date };

export function mayPropose(latest: LatestAction | null, now: Date): ProposalCheck {
  if (latest === null) return { ok: true };
  if (OPEN.has(latest.status)) return { ok: false, reason: "OPEN_DUPLICATE" };

  const cooldown =
    latest.status === "REJECTED" || latest.status === "UNDONE"
      ? { reason: "DISMISSED_COOLDOWN" as const, ms: COOLDOWN_MS.dismissed }
      : latest.status === "EXPIRED"
        ? { reason: "EXPIRED_COOLDOWN" as const, ms: COOLDOWN_MS.expired }
        : null;
  if (cooldown === null) return { ok: true };

  const until = new Date(latest.decidedAt.getTime() + cooldown.ms);
  return now.getTime() < until.getTime() ? { ok: false, reason: cooldown.reason, until } : { ok: true };
}
