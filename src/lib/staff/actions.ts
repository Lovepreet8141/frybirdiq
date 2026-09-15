"use server";

/**
 * The staff roster's writes: invite, deactivate, change role. Roadmap 6.1.
 *
 * Every action re-checks `staff.manage` itself — rendering the roster screen
 * is not authorization for a request submitted against it (§41) — and every
 * one delegates its actual ceiling check (`canGrantRole`, applied both to
 * the role being granted and to whatever the target currently holds) to
 * `lib/repositories/staff.ts`, so the rule lives in exactly one place.
 */

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { NotPermitted, NotSignedIn, requirePermission } from "@/lib/auth";
import { ROLES, type Role } from "@/domain/permissions";
import { changeStaffRole, deactivateStaff, inviteStaff } from "@/lib/repositories/staff";

export type StaffActionResult = { ok: true; message: string } | { ok: false; error: string };

async function authorise(): Promise<{ orgId: string; userId: string; roles: readonly Role[] } | { error: string }> {
  try {
    const staff = await requirePermission("staff.manage");
    return { orgId: staff.orgId, userId: staff.userId, roles: staff.roles };
  } catch (error) {
    if (error instanceof NotSignedIn) return { error: "You've been signed out. Sign in again." };
    if (error instanceof NotPermitted) return { error: "You don't have permission to manage staff." };
    throw error;
  }
}

const roleSchema = z.enum(ROLES);

const inviteSchema = z.object({
  email: z.email("Enter a valid email address.").max(160),
  role: roleSchema,
});

export async function inviteStaffAction(raw: unknown): Promise<StaffActionResult> {
  const parsed = inviteSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the form." };

  const auth = await authorise();
  if ("error" in auth) return { ok: false, error: auth.error };

  const result = await inviteStaff(auth.orgId, auth.userId, parsed.data.email, parsed.data.role);
  if (!result.ok) return result;

  revalidatePath("/app/staff");
  return { ok: true, message: result.resent ? "Invite re-sent." : `Invite sent to ${parsed.data.email}.` };
}

const targetUserSchema = z.uuid("That account could not be found.");

export async function deactivateStaffAction(rawUserId: unknown): Promise<StaffActionResult> {
  const parsedUserId = targetUserSchema.safeParse(rawUserId);
  if (!parsedUserId.success) return { ok: false, error: parsedUserId.error.issues[0]?.message ?? "That account could not be found." };

  const auth = await authorise();
  if ("error" in auth) return { ok: false, error: auth.error };
  if (parsedUserId.data === auth.userId) return { ok: false, error: "You can't deactivate your own account." };

  const result = await deactivateStaff(auth.orgId, auth.userId, auth.roles, parsedUserId.data);
  if (!result.ok) return result;

  revalidatePath("/app/staff");
  return { ok: true, message: "Deactivated." };
}

const roleChangeSchema = z.object({
  userId: z.uuid(),
  role: roleSchema,
});

export async function changeStaffRoleAction(raw: unknown): Promise<StaffActionResult> {
  const parsed = roleChangeSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "That request could not be read." };

  const auth = await authorise();
  if ("error" in auth) return { ok: false, error: auth.error };
  if (parsed.data.userId === auth.userId) return { ok: false, error: "You can't change your own role here — ask another owner or admin." };

  const result = await changeStaffRole(auth.orgId, auth.userId, auth.roles, parsed.data.userId, parsed.data.role);
  if (!result.ok) return result;

  revalidatePath("/app/staff");
  return { ok: true, message: `Role changed to ${parsed.data.role}.` };
}
