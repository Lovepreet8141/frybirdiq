import "server-only";

/**
 * iq_auto_policies — the owner's switch for running one A1 action kind
 * automatically, per org and optionally per location.
 *
 * DESIGN-v2-DELTA.md §4. Every change is ONE transaction: a compare-and-set
 * on `version` (create when the caller expects none), then an audit_logs row
 * linked back from the policy. Two owners saving at once cannot both win; the
 * second gets VERSION_CONFLICT and must reload.
 *
 * Switching a policy ON is refused for a kind outside A1_AUTO_ALLOWED (empty
 * until owner decision dec-4), so the screen can never show "automatic" for
 * something the engine will still send for approval. Switching OFF is always
 * allowed.
 *
 * The caller (a server action) has already checked
 * `staffCan("iq.autopolicy.manage")` for `orgId`; every statement here still
 * filters on `orgId` itself, because the app connects as `postgres`.
 */

import { and, eq, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { auditLogs, iqAutoPolicies, locations } from "@/db/schema";
import {
  A1_AUTO_ALLOWED,
  ACTION_CATALOG,
  AutoPolicyLimitsSchema,
  isActionKind,
  type ActionKind,
  type AutoPolicy,
} from "@/lib/iq/automation";

const SetAutoPolicySchema = z.strictObject({
  orgId: z.uuid(),
  userId: z.uuid(),
  actionKind: z.string().refine((k) => isActionKind(k) && ACTION_CATALOG[k].tier === "A1", "not an A1 action kind"),
  locationId: z.uuid().nullable(),
  enabled: z.boolean(),
  limits: AutoPolicyLimitsSchema,
  reason: z.string().trim().min(1).max(500),
  /** The version the owner was looking at, or null to create the policy. */
  expectedVersion: z.number().int().min(1).nullable(),
});
export type SetAutoPolicyInput = z.input<typeof SetAutoPolicySchema>;

export type SetAutoPolicyResult =
  | { readonly ok: true; readonly policy: AutoPolicy }
  | { readonly ok: false; readonly reason: "INVALID" | "NOT_ALLOWLISTED" | "LOCATION_NOT_FOUND" | "NOT_FOUND" | "VERSION_CONFLICT" };

export type SetAutoPolicyOptions = {
  /** Test seam; production always uses A1_AUTO_ALLOWED. */
  readonly allowedAutoKinds?: readonly ActionKind[];
};

const POLICY_COLUMNS = {
  id: iqAutoPolicies.id,
  actionKind: iqAutoPolicies.actionKind,
  locationId: iqAutoPolicies.locationId,
  enabled: iqAutoPolicies.enabled,
  limits: iqAutoPolicies.limits,
  version: iqAutoPolicies.version,
};

const sameLocation = (locationId: string | null) =>
  locationId === null ? isNull(iqAutoPolicies.locationId) : eq(iqAutoPolicies.locationId, locationId);

/**
 * The policy that governs `actionKind` at `locationId`: the location's own
 * row if there is one, else the org-wide row, else null. Feed it to
 * `evaluateAutoPolicy`.
 */
export async function getAutoPolicy(orgId: string, actionKind: ActionKind, locationId: string | null): Promise<AutoPolicy | null> {
  const rows = await db()
    .select(POLICY_COLUMNS)
    .from(iqAutoPolicies)
    .where(
      and(
        eq(iqAutoPolicies.orgId, orgId),
        eq(iqAutoPolicies.actionKind, actionKind),
        locationId === null ? isNull(iqAutoPolicies.locationId) : or(eq(iqAutoPolicies.locationId, locationId), isNull(iqAutoPolicies.locationId)),
      ),
    );
  const own = rows.find((r) => r.locationId !== null);
  return own ?? rows[0] ?? null;
}

export async function setAutoPolicy(input: SetAutoPolicyInput, options: SetAutoPolicyOptions = {}): Promise<SetAutoPolicyResult> {
  const parsed = SetAutoPolicySchema.safeParse(input);
  if (!parsed.success) return { ok: false, reason: "INVALID" };
  const change = parsed.data;
  const kind = change.actionKind as ActionKind;

  const allowed = options.allowedAutoKinds ?? A1_AUTO_ALLOWED;
  if (change.enabled && !allowed.includes(kind)) return { ok: false, reason: "NOT_ALLOWLISTED" };

  return db().transaction(async (tx) => {
    if (change.locationId !== null) {
      const [location] = await tx
        .select({ id: locations.id })
        .from(locations)
        .where(and(eq(locations.id, change.locationId), eq(locations.orgId, change.orgId)));
      if (!location) return { ok: false, reason: "LOCATION_NOT_FOUND" } as const;
    }

    const scope = and(
      eq(iqAutoPolicies.orgId, change.orgId),
      eq(iqAutoPolicies.actionKind, kind),
      sameLocation(change.locationId),
    );

    let before: AutoPolicy | null = null;
    let saved: AutoPolicy | undefined;
    if (change.expectedVersion === null) {
      [saved] = await tx
        .insert(iqAutoPolicies)
        .values({
          orgId: change.orgId,
          actionKind: kind,
          locationId: change.locationId,
          enabled: change.enabled,
          limits: change.limits,
          version: 1,
          setBy: change.userId,
          reason: change.reason,
        })
        .onConflictDoNothing()
        .returning(POLICY_COLUMNS);
      if (!saved) return { ok: false, reason: "VERSION_CONFLICT" } as const;
    } else {
      // Row lock + read of the old values, so the audit row records what was replaced.
      const [current] = await tx.select(POLICY_COLUMNS).from(iqAutoPolicies).where(scope).for("update");
      if (!current) return { ok: false, reason: "NOT_FOUND" } as const;
      if (current.version !== change.expectedVersion) return { ok: false, reason: "VERSION_CONFLICT" } as const;
      before = current;
      [saved] = await tx
        .update(iqAutoPolicies)
        .set({
          enabled: change.enabled,
          limits: change.limits,
          version: sql`${iqAutoPolicies.version} + 1`,
          setBy: change.userId,
          setAt: sql`now()`,
          reason: change.reason,
          updatedAt: sql`now()`,
        })
        .where(and(scope, eq(iqAutoPolicies.version, change.expectedVersion)))
        .returning(POLICY_COLUMNS);
      if (!saved) return { ok: false, reason: "VERSION_CONFLICT" } as const;
    }

    const [audit] = await tx
      .insert(auditLogs)
      .values({
        orgId: change.orgId,
        locationId: change.locationId,
        actorUserId: change.userId,
        action: "iq_auto_policy_set",
        entity: "iq_auto_policies",
        entityId: saved.id,
        before: before === null ? null : { enabled: before.enabled, limits: before.limits, version: before.version },
        after: { actionKind: kind, enabled: saved.enabled, limits: saved.limits, version: saved.version, reason: change.reason },
      })
      .returning({ id: auditLogs.id });
    if (!audit) throw new Error("iq-auto-policies: audit insert returned no row");

    await tx
      .update(iqAutoPolicies)
      .set({ auditLogId: audit.id })
      .where(and(eq(iqAutoPolicies.id, saved.id), eq(iqAutoPolicies.orgId, change.orgId)));

    return { ok: true, policy: saved } as const;
  });
}
