import "server-only";

/**
 * The general audit log — who did what, when, before/after. §52.
 *
 * Distinct from `menuAuditLog` (read by `getRecentChanges`, already surfaced
 * on the Menu review queue): this is `platform.ts`'s `auditLogs` table, the
 * one written today from `payments.ts`'s cash-settlement path
 * (`action: "payment_captured"`) and meant to be the home for every future
 * sensitive action (price changes, refunds, permission changes) once they
 * start writing to it. This module only reads it — nothing here writes an
 * audit row.
 */

import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { auditLogs, memberships } from "@/db/schema";

export interface AuditEntry {
  readonly id: string;
  readonly action: string;
  readonly entity: string;
  readonly entityId: string | null;
  readonly actorName: string | null;
  readonly before: Record<string, unknown> | null;
  readonly after: Record<string, unknown> | null;
  readonly createdAt: Date;
}

/** The most recent audit events, newest first, with the actor resolved to a display name where one exists. */
export async function getAuditLog(orgId: string, limit = 100): Promise<readonly AuditEntry[]> {
  const rows = await db()
    .select({
      id: auditLogs.id,
      action: auditLogs.action,
      entity: auditLogs.entity,
      entityId: auditLogs.entityId,
      actorUserId: auditLogs.actorUserId,
      before: auditLogs.before,
      after: auditLogs.after,
      createdAt: auditLogs.createdAt,
    })
    .from(auditLogs)
    .where(eq(auditLogs.orgId, orgId))
    .orderBy(desc(auditLogs.createdAt))
    .limit(limit);

  const actorIds = [...new Set(rows.map((row) => row.actorUserId).filter((id): id is string => id !== null))];
  const staffRows =
    actorIds.length > 0
      ? await db()
          .select({ userId: memberships.userId, displayName: memberships.displayName })
          .from(memberships)
          .where(and(eq(memberships.orgId, orgId), inArray(memberships.userId, actorIds)))
      : [];
  const nameByUser = new Map(staffRows.map((row) => [row.userId, row.displayName]));

  return rows.map((row) => ({
    id: row.id,
    action: row.action,
    entity: row.entity,
    entityId: row.entityId,
    // Null actor is a system-initiated event (a webhook, a timeout), not a missing fact.
    actorName: row.actorUserId ? (nameByUser.get(row.actorUserId) ?? "Former staff member") : "System",
    before: row.before,
    after: row.after,
    createdAt: row.createdAt,
  }));
}
