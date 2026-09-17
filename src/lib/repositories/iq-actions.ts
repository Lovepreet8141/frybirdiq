import "server-only";

/**
 * Approval-inbox decisions on iq_actions — approve or reject one action.
 *
 * DESIGN-v2-DELTA.md §4. Each decision is ONE transaction:
 *
 *   1. a compare-and-set UPDATE on iq_actions that only matches a row a
 *      person decides (A1 without a policy, or A2), in this org, still
 *      PENDING_APPROVAL, with the params hash the person saw, and not yet
 *      expired by the database's now();
 *   2. the linked recommendation leaves PROPOSED the same way;
 *   3. an audit_logs row, linked back from the action.
 *
 * Nothing else is locked or read first, so two people deciding at once
 * cannot both win: the second UPDATE waits for the first and then matches
 * nothing. A miss is classified by `classifyDecisionMiss`, and the same
 * person repeating the same decision is reported as success. No
 * withIdempotency — the CAS is the idempotency.
 *
 * The caller (a server action) has already checked `staffCan("iq.approve")`
 * for `orgId`; every statement here still filters on `orgId` itself, because
 * the app connects as `postgres` and row-level security does not apply.
 */

import { and, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { auditLogs, iqActions, iqRecommendations } from "@/db/schema";
import { ACTION_STATUSES, EXECUTE_WINDOW_SECONDS, type ActionStatus } from "@/lib/iq/automation";
import { ActionTierSchema } from "@/lib/iq/engine";
import { classifyDecisionMiss, type Decision, type DecisionOutcome } from "@/lib/iq/automation/approval";

export type ActionDecisionInput = {
  readonly orgId: string;
  readonly actionId: string;
  /** The staff member deciding; recorded as approved_by / decided_by and the audit actor. */
  readonly userId: string;
  /** The params hash the person was shown. A different current hash is STALE_PARAMS. */
  readonly paramsHash: string;
  /** Rejections only; at most 500 characters. */
  readonly reason?: string;
};

const isActionStatus = (value: string): value is ActionStatus => (ACTION_STATUSES as readonly string[]).includes(value);

const SHA256_HEX = /^[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function malformed(input: ActionDecisionInput): boolean {
  return (
    !UUID.test(input.orgId) ||
    !UUID.test(input.actionId) ||
    !UUID.test(input.userId) ||
    !SHA256_HEX.test(input.paramsHash) ||
    (input.reason !== undefined && input.reason.length > 500)
  );
}

export function approveAction(input: ActionDecisionInput): Promise<DecisionOutcome> {
  return decide("APPROVE", input);
}

export function rejectAction(input: ActionDecisionInput): Promise<DecisionOutcome> {
  return decide("REJECT", input);
}

async function decide(decision: Decision, input: ActionDecisionInput): Promise<DecisionOutcome> {
  // An id that is not a uuid cannot name a row; answer before Postgres rejects the cast.
  if (malformed(input)) return { ok: false, reason: "NOT_FOUND" };

  return db().transaction(async (tx) => {
    const approving = decision === "APPROVE";
    const [updated] = await tx
      .update(iqActions)
      .set(
        approving
          ? {
              status: "APPROVED",
              approvedBy: input.userId,
              approvedAt: sql`now()`,
              executeBy: sql`now() + make_interval(secs => ${EXECUTE_WINDOW_SECONDS})`,
              updatedAt: sql`now()`,
            }
          : { status: "REJECTED", decidedBy: input.userId, updatedAt: sql`now()` },
      )
      .where(
        and(
          eq(iqActions.id, input.actionId),
          eq(iqActions.orgId, input.orgId),
          inArray(iqActions.tier, ["A1", "A2"]),
          isNull(iqActions.autoPolicyId),
          eq(iqActions.status, "PENDING_APPROVAL"),
          eq(iqActions.paramsHash, input.paramsHash),
          gt(iqActions.approvalExpiresAt, sql`now()`),
        ),
      )
      .returning({
        id: iqActions.id,
        locationId: iqActions.locationId,
        recommendationId: iqActions.recommendationId,
        actionKind: iqActions.actionKind,
        tier: iqActions.tier,
      });

    if (!updated) {
      const [row] = await tx
        .select({
          tier: iqActions.tier,
          autoPolicyId: iqActions.autoPolicyId,
          status: iqActions.status,
          paramsHash: iqActions.paramsHash,
          approvalExpiresAt: iqActions.approvalExpiresAt,
          approvedBy: iqActions.approvedBy,
          decidedBy: iqActions.decidedBy,
          dbNow: sql<Date>`now()`.mapWith((v: string | Date) => new Date(v)),
        })
        .from(iqActions)
        .where(and(eq(iqActions.id, input.actionId), eq(iqActions.orgId, input.orgId)));
      if (!row) return { ok: false, reason: "NOT_FOUND" } as const;
      const { dbNow, tier, status, ...view } = row;
      const parsedTier = ActionTierSchema.safeParse(tier);
      if (!parsedTier.success || !isActionStatus(status)) return { ok: false, reason: "NOT_FOUND" } as const;
      return classifyDecisionMiss(
        { ...view, tier: parsedTier.data, status },
        { decision, userId: input.userId, paramsHash: input.paramsHash },
        dbNow,
      );
    }

    if (updated.recommendationId !== null) {
      await tx
        .update(iqRecommendations)
        .set({
          status: approving ? "APPROVED" : "DISMISSED",
          decidedByUserId: input.userId,
          decidedAt: sql`now()`,
          decisionReason: approving ? null : (input.reason ?? null),
          updatedAt: sql`now()`,
        })
        .where(
          and(
            eq(iqRecommendations.id, updated.recommendationId),
            eq(iqRecommendations.orgId, input.orgId),
            eq(iqRecommendations.status, "PROPOSED"),
          ),
        );
    }

    const [audit] = await tx
      .insert(auditLogs)
      .values({
        orgId: input.orgId,
        locationId: updated.locationId,
        actorUserId: input.userId,
        action: approving ? "iq_action_approved" : "iq_action_rejected",
        entity: "iq_actions",
        entityId: updated.id,
        before: { status: "PENDING_APPROVAL" },
        after: {
          status: approving ? "APPROVED" : "REJECTED",
          actionKind: updated.actionKind,
          tier: updated.tier,
          paramsHash: input.paramsHash,
          ...(approving ? {} : { reason: input.reason ?? null }),
        },
      })
      .returning({ id: auditLogs.id });
    if (!audit) throw new Error("iq-actions: audit insert returned no row");

    await tx
      .update(iqActions)
      .set({ auditLogId: audit.id })
      .where(and(eq(iqActions.id, updated.id), eq(iqActions.orgId, input.orgId)));

    return { ok: true, repeated: false } as const;
  });
}
