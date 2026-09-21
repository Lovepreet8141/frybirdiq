import "server-only";

/**
 * The staff roster, and the invite / deactivate / role-change writes on top
 * of it. Roadmap 6.1.
 *
 * The permission-model decision this module's header used to flag as
 * outstanding ("who may grant what to whom") is now made, conservatively:
 * every write here re-checks `staff.manage` (the caller's job, via
 * `src/lib/staff/actions.ts`) and is further capped by
 * `domain/permissions.ts`'s `canGrantRole` — an actor can never hand out, or
 * act on an account holding, a role that can do something the actor's own
 * roles cannot. `pnpm staff:grant` (see `scripts/grant-role.ts`) still exists
 * for the one case this UI does not cover: granting a role to an email that
 * already has a Supabase Auth account under something other than a pending
 * invite (a former customer becoming staff, say).
 */

import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { auditLogs, memberships } from "@/db/schema";
import { type Role, canGrantRole } from "@/domain/permissions";
import { serverEnv } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/server";

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

/** Where an invite email's "set your password" link lands. Unset only in a shell with no Supabase project yet — see `lib/customer/actions.ts`'s identical `confirmRedirectUrl`. */
function inviteRedirectUrl(): string | undefined {
  const site = serverEnv().SITE_URL;
  return site ? `${site.replace(/\/$/, "")}/accept-invite` : undefined;
}

export type InviteStaffResult = { ok: true; resent: boolean } | { ok: false; error: string };

/**
 * Sends a Supabase Auth invite by email and creates (or reactivates) the
 * membership that lets the accepted invite into the org with `role`.
 *
 * `createAdminClient` bypasses row-level security, justified the same way
 * `lib/repositories/media.ts` justifies it: this only runs from a Server
 * Action already gated on `staff.manage` and `canGrantRole`, never from a
 * request a stranger controls.
 *
 * An email that already has a Supabase Auth account — staff, customer, or a
 * still-pending invite — is a real, expected case, not a crash: Supabase
 * refuses to invite it twice, and a pending invite is instead resent.
 */
export async function inviteStaff(orgId: string, actorUserId: string, actorRoles: readonly Role[], email: string, role: Role): Promise<InviteStaffResult> {
  // The ceiling first, before Supabase Auth is contacted: a refused invite must not leave an auth user behind.
  // Same rule as `changeStaffRole` and `deactivateStaff`; without it `staff.manage` alone could mint an OWNER (p0-7).
  if (!canGrantRole(actorRoles, role)) {
    return { ok: false, error: `Your account can't invite someone as ${role} — that role can do more than yours can.` };
  }

  const supabase = createAdminClient();
  const { data, error } = await supabase.auth.admin.inviteUserByEmail(email, { redirectTo: inviteRedirectUrl() });

  if (error || !data.user) {
    // `email_exists` is the documented AuthError code; the status/message
    // checks are a fallback for a Supabase version that predates it.
    if (error?.code === "email_exists" || error?.status === 422 || /already been registered|already exists/i.test(error?.message ?? "")) {
      return { ok: false, error: `${email} already has an account. If they've lost their invite, ask an owner to check the Supabase dashboard rather than inviting them again.` };
    }
    return { ok: false, error: "The invite could not be sent. Try again in a moment." };
  }

  const userId = data.user.id;

  return db().transaction(async (tx) => {
    // Insert first and let the unique (org, user, role) index arbitrate: two identical invites in flight
    // used to both see "no row" and the loser died on a unique violation (a 500). The loser now takes the resend path (invite-race-1).
    const [inserted] = await tx.insert(memberships).values({ orgId, userId, role, displayName: email.split("@")[0] }).onConflictDoNothing().returning();
    if (inserted) {
      await tx.insert(auditLogs).values({ orgId, actorUserId, action: "staff_invited", entity: "memberships", entityId: inserted.id, after: { email, role } });
      return { ok: true, resent: false };
    }

    const [existing] = await tx
      .select()
      .from(memberships)
      .where(and(eq(memberships.orgId, orgId), eq(memberships.userId, userId), eq(memberships.role, role)))
      .limit(1);

    if (existing) {
      // Supabase resent the email for a user it already knew about (most
      // likely: this is the second time someone clicked "Invite" before the
      // first email was accepted) — reactivating rather than erroring keeps
      // a double-tap idempotent instead of stuck.
      if (!existing.isActive) await tx.update(memberships).set({ isActive: true }).where(eq(memberships.id, existing.id));
      await tx.insert(auditLogs).values({ orgId, actorUserId, action: "staff_invited", entity: "memberships", entityId: existing.id, after: { email, role } });
      return { ok: true, resent: true };
    }

    return { ok: false, error: "The invite could not be recorded. Try again." };
  });
}

export type StaffWriteResult = { ok: true } | { ok: false; error: string };

/**
 * Deactivates every active role this person holds. Does not delete the
 * membership rows — cash settlements and audit rows already reference them
 * by `userId`, and a deactivated account is a fact worth keeping, not
 * erasing.
 *
 * `actorRoles` caps who this can be used on: never someone holding a role
 * more powerful than the actor's own, so `staff.manage` alone can never let
 * an ADMIN lock an OWNER out.
 */
export async function deactivateStaff(orgId: string, actorUserId: string, actorRoles: readonly Role[], targetUserId: string): Promise<StaffWriteResult> {
  return db().transaction(async (tx) => {
    // FOR UPDATE: the role ceiling below is decided from these rows, so a simultaneous role change on the same person must finish first (staff-lock-1).
    const rows = await tx.select().from(memberships).where(and(eq(memberships.orgId, orgId), eq(memberships.userId, targetUserId))).for("update");
    if (rows.length === 0) return { ok: false, error: "That person is not on the roster." };

    const activeRoles = rows.filter((row) => row.isActive).map((row) => row.role);
    if (activeRoles.length === 0) return { ok: false, error: "That account is already deactivated." };
    if (!activeRoles.every((role) => canGrantRole(actorRoles, role))) {
      return { ok: false, error: "Your account can't deactivate someone whose role can do more than yours can." };
    }

    await tx.update(memberships).set({ isActive: false }).where(and(eq(memberships.orgId, orgId), eq(memberships.userId, targetUserId)));
    await tx.insert(auditLogs).values({ orgId, actorUserId, action: "staff_deactivated", entity: "memberships", entityId: targetUserId, before: { roles: activeRoles } });
    return { ok: true };
  });
}

/**
 * Replaces every active role this person holds with exactly one: `newRole`.
 *
 * FRYBIRD is single-location and, in practice, single-role-per-person (see
 * CLAUDE.md — "single owner-operator, one location"); the roster screen's
 * one role-change control is "make this person a MANAGER", not a per-badge
 * multi-role editor. Someone who genuinely needs more than one role held at
 * once is the rare case `pnpm staff:grant` (`scripts/grant-role.ts`) already
 * serves directly against Postgres.
 *
 * Same ceiling as `deactivateStaff`: the new role must be one the actor
 * could grant, and every role the target currently holds must be one the
 * actor could also grant — otherwise `staff.manage` alone would let an ADMIN
 * either promote someone past ADMIN or reach into an OWNER's account.
 */
export async function changeStaffRole(orgId: string, actorUserId: string, actorRoles: readonly Role[], targetUserId: string, newRole: Role): Promise<StaffWriteResult> {
  if (!canGrantRole(actorRoles, newRole)) {
    return { ok: false, error: `Your account can't grant the ${newRole} role — it can do more than yours can.` };
  }

  return db().transaction(async (tx) => {
    // FOR UPDATE: the role ceiling below is decided from these rows, so a simultaneous role change on the same person must finish first (staff-lock-1).
    const rows = await tx.select().from(memberships).where(and(eq(memberships.orgId, orgId), eq(memberships.userId, targetUserId))).for("update");
    if (rows.length === 0) return { ok: false, error: "That person is not on the roster." };

    const active = rows.filter((row) => row.isActive);
    if (active.length === 0) return { ok: false, error: "That account is deactivated. Reactivate it first." };
    if (!active.every((row) => canGrantRole(actorRoles, row.role))) {
      return { ok: false, error: "Your account can't change the role of someone whose role can do more than yours can." };
    }
    if (active.length === 1 && active[0]?.role === newRole) return { ok: false, error: "That person already holds that role." };

    const beforeRoles = active.map((row) => row.role);
    const targetRow = rows.find((row) => row.role === newRole);

    if (targetRow) {
      await tx.update(memberships).set({ isActive: true }).where(eq(memberships.id, targetRow.id));
    } else {
      const template = active[0];
      if (!template) return { ok: false, error: "That person is not on the roster." };
      await tx.insert(memberships).values({ orgId, userId: targetUserId, role: newRole, displayName: template.displayName, isActive: true });
    }

    // Everything else this person actively held is superseded by the new role.
    for (const row of active) {
      if (row.role !== newRole) await tx.update(memberships).set({ isActive: false }).where(eq(memberships.id, row.id));
    }

    await tx.insert(auditLogs).values({ orgId, actorUserId, action: "staff_role_changed", entity: "memberships", entityId: targetUserId, before: { roles: beforeRoles }, after: { roles: [newRole] } });
    return { ok: true };
  });
}
