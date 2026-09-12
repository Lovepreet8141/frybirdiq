import "server-only";

/**
 * The staff roster — read-only. Accounts are still provisioned via
 * `pnpm staff:grant` (see `scripts/grant-role.ts`); this only lists what
 * already exists. Inviting, editing a role, or deactivating someone needs a
 * real permission-model decision (who may grant what to whom) that a list
 * page must not make on its own — see FRYBIRD-IQ-PROGRESS.md's stop-condition
 * note on Phase H.
 */

import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { memberships } from "@/db/schema";
import type { Role } from "@/domain/permissions";

export interface StaffMember {
  readonly userId: string;
  readonly displayName: string | null;
  readonly roles: readonly Role[];
  /** True if any of this person's role rows is active — a demoted-but-not-removed account still has some access. */
  readonly isActive: boolean;
  readonly joinedAt: Date;
}

/** Every membership row, grouped by person — one row per role becomes one card per staff member. */
export async function listStaff(orgId: string): Promise<readonly StaffMember[]> {
  const rows = await db()
    .select({
      userId: memberships.userId,
      displayName: memberships.displayName,
      role: memberships.role,
      isActive: memberships.isActive,
      createdAt: memberships.createdAt,
    })
    .from(memberships)
    .where(eq(memberships.orgId, orgId))
    .orderBy(asc(memberships.createdAt));

  const byUser = new Map<string, { displayName: string | null; roles: Role[]; isActive: boolean; joinedAt: Date }>();
  for (const row of rows) {
    const existing = byUser.get(row.userId);
    if (existing) {
      existing.roles.push(row.role);
      existing.isActive = existing.isActive || row.isActive;
      if (row.createdAt < existing.joinedAt) existing.joinedAt = row.createdAt;
    } else {
      byUser.set(row.userId, { displayName: row.displayName, roles: [row.role], isActive: row.isActive, joinedAt: row.createdAt });
    }
  }

  return [...byUser.entries()].map(([userId, value]) => ({ userId, ...value }));
}
