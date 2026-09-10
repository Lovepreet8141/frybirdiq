import "server-only";

/**
 * Who is signed in, and what they may do.
 *
 * BUILD-PLAN.md §41: "Never rely only on hiding UI buttons. Authorization must
 * happen server-side."
 *
 * That is doubly true here. The application queries Postgres as the `postgres`
 * role, which bypasses row-level security entirely — the policies guard the
 * Supabase client paths, not Drizzle. So this module is not a convenience on
 * top of a database-enforced boundary. For staff screens it *is* the boundary.
 */

import { cache } from "react";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { memberships } from "@/db/schema";
import { type Permission, type Role, can } from "@/domain/permissions";
import { isSupabaseConfigured } from "@/lib/env";
import { createServerClient } from "@/lib/supabase/server";
import { getOrg } from "@/lib/repositories/org";

export interface Staff {
  readonly userId: string;
  readonly email: string | null;
  readonly displayName: string | null;
  readonly orgId: string;
  readonly roles: readonly Role[];
}

/**
 * The signed-in staff member, or null.
 *
 * Resolved once per request. Two things must both hold: a valid Supabase
 * session, and an active membership of this organization. An authenticated
 * user with no membership is a stranger with an account, not staff.
 *
 * `getUser()` rather than `getSession()` — getSession reads the cookie without
 * verifying it against the auth server, so it can be forged.
 */
export const getStaff = cache(async (): Promise<Staff | null> => {
  if (!isSupabaseConfigured()) return null;

  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const org = await getOrg();
  if (!org) return null;

  const rows = await db()
    .select()
    .from(memberships)
    .where(and(eq(memberships.userId, user.id), eq(memberships.orgId, org.id), eq(memberships.isActive, true)));

  if (rows.length === 0) return null;

  return {
    userId: user.id,
    email: user.email ?? null,
    displayName: rows[0]?.displayName ?? user.email ?? null,
    orgId: org.id,
    // A person can hold more than one role; permissions are the union.
    roles: rows.map((row) => row.role),
  };
});

export class NotSignedIn extends Error {
  constructor() {
    super("auth: not signed in");
    this.name = "NotSignedIn";
  }
}

export class NotPermitted extends Error {
  constructor(readonly permission: Permission) {
    super(`auth: this account cannot ${permission}`);
    this.name = "NotPermitted";
  }
}

/** Throws unless someone is signed in with a membership. */
export async function requireStaff(): Promise<Staff> {
  const staff = await getStaff();
  if (!staff) throw new NotSignedIn();
  return staff;
}

/**
 * Throws unless the signed-in staff member holds the permission.
 *
 * Every server action behind a staff screen calls this. Rendering a screen is
 * not authorization for the actions on it — a form can be submitted without
 * ever loading the page that shows it.
 */
export async function requirePermission(permission: Permission): Promise<Staff> {
  const staff = await requireStaff();
  if (!can(staff.roles, permission)) throw new NotPermitted(permission);
  return staff;
}

/** For hiding UI. Never the only check — the action re-checks server-side. */
export async function staffCan(permission: Permission): Promise<boolean> {
  const staff = await getStaff();
  return staff ? can(staff.roles, permission) : false;
}
