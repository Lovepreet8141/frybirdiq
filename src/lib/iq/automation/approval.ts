/**
 * Why an approval or rejection did not land.
 *
 * DESIGN-v2-DELTA.md §4. Approving is one compare-and-set UPDATE on
 * iq_actions (repositories/iq-actions.ts). When it matches no row, this reads
 * the row as it now is and names the reason, in a fixed order:
 *
 *   NOT_FOUND        no such row in this org, or not a row a person decides
 *                    (A0, A3, or an A1 running under an auto policy)
 *   repeated success the same person already made the same decision on the
 *                    same params — a double tap is not an error
 *   ALREADY_DECIDED  anything else that has left PENDING_APPROVAL
 *   SUPERSEDED       the linked recommendation was replaced (its evidence
 *                    changed), so the action stands on stale grounds
 *   EXPIRED          the linked recommendation expired
 *   ALREADY_DECIDED  the linked recommendation was decided some other way
 *   STALE_PARAMS     the proposal changed since the person looked at it
 *   EXPIRED          the request lapsed (database time)
 */
import type { ActionTier } from "../engine";
import type { ActionStatus } from "./state-machine";

export type Decision = "APPROVE" | "REJECT";

export type DecisionMiss = "NOT_FOUND" | "ALREADY_DECIDED" | "SUPERSEDED" | "STALE_PARAMS" | "EXPIRED";

/** iq_recommendations.status of the action's recommendation, or null when the action has none. */
export type RecommendationStatus = "PROPOSED" | "APPROVED" | "DISMISSED" | "EXPIRED" | "SUPERSEDED";

export type DecisionOutcome = { readonly ok: true; readonly repeated: boolean } | { readonly ok: false; readonly reason: DecisionMiss };

export type DecisionRowView = {
  readonly tier: ActionTier;
  readonly autoPolicyId: string | null;
  readonly status: ActionStatus;
  readonly paramsHash: string;
  readonly approvalExpiresAt: Date | null;
  readonly approvedBy: string | null;
  readonly decidedBy: string | null;
};

export type DecisionRequest = {
  readonly decision: Decision;
  readonly userId: string;
  readonly paramsHash: string;
};

/** Statuses an approved APPROVAL-mode row can be in. */
const APPROVED_PATH: ReadonlySet<ActionStatus> = new Set(["APPROVED", "EXECUTING", "SUCCEEDED", "FAILED", "UNDONE"]);

export function isPersonDecided(row: Pick<DecisionRowView, "tier" | "autoPolicyId">): boolean {
  return row.autoPolicyId === null && (row.tier === "A1" || row.tier === "A2");
}

export function classifyDecisionMiss(
  row: DecisionRowView | null,
  request: DecisionRequest,
  dbNow: Date,
  recommendation: RecommendationStatus | null = null,
): DecisionOutcome {
  if (row === null || !isPersonDecided(row)) return { ok: false, reason: "NOT_FOUND" };

  const sameParams = row.paramsHash === request.paramsHash;
  if (request.decision === "APPROVE" && sameParams && row.approvedBy === request.userId && APPROVED_PATH.has(row.status)) {
    return { ok: true, repeated: true };
  }
  if (request.decision === "REJECT" && sameParams && row.decidedBy === request.userId && row.status === "REJECTED") {
    return { ok: true, repeated: true };
  }

  if (row.status !== "PENDING_APPROVAL") return { ok: false, reason: "ALREADY_DECIDED" };
  if (recommendation === "SUPERSEDED") return { ok: false, reason: "SUPERSEDED" };
  if (recommendation === "EXPIRED") return { ok: false, reason: "EXPIRED" };
  if (recommendation === "APPROVED" || recommendation === "DISMISSED") return { ok: false, reason: "ALREADY_DECIDED" };
  if (!sameParams) return { ok: false, reason: "STALE_PARAMS" };
  if (row.approvalExpiresAt === null || row.approvalExpiresAt.getTime() <= dbNow.getTime()) return { ok: false, reason: "EXPIRED" };
  // The update missed but the row reads as decidable: it changed and changed back between the two statements.
  return { ok: false, reason: "ALREADY_DECIDED" };
}
