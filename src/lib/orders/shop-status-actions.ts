"use server";

/**
 * Pause and resume online ordering — the Close Shop switch (ops-1 S3).
 *
 * The one pair of actions both staff controls call: the POS header (S4a) and
 * Admin → Restaurant (S4b). Server Actions are public HTTP endpoints, so each
 * call re-checks the permission here; a hidden button is not authorization
 * (§41). The org is always the signed-in staff member's own — never taken
 * from the request.
 *
 * `orders.update`, both ways (god's ruling D2): OWNER, ADMIN, MANAGER and
 * CASHIER — whoever is running the till when the power goes. Not
 * `settings.manage`, which is OWNER-only and would leave a 9 pm kitchen fire
 * with nobody able to press it. KITCHEN and RIDER cannot.
 */

import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { z } from "zod";
import { NotPermitted, NotSignedIn, requirePermission } from "@/lib/auth";
import { type PauseOrderingResult, type ResumeOrderingResult, pauseOrdering, resumeOrdering } from "@/lib/repositories/shop-status";

type ActionFailure = { readonly ok: false; readonly code: "INVALID_INPUT" | "SIGNED_OUT" | "NOT_PERMITTED" | "SERVER_ERROR"; readonly error: string };

export type PauseOrderingActionResult = PauseOrderingResult | ActionFailure;
export type ResumeOrderingActionResult = ResumeOrderingResult | ActionFailure;

const pauseSchema = z.object({
  /** Staff's own words, for the audit trail and the other till. Never shown to a customer. */
  reason: z.string().trim().min(3, "Say why, in a few words.").max(200, "Keep it under 200 characters."),
  /** The owner's default is "until we next open". */
  mode: z.enum(["UNTIL_NEXT_OPENING", "UNTIL_RESUMED"]).default("UNTIL_NEXT_OPENING"),
});

const resumeSchema = z.object({
  /** The pausedAt the screen showed, as an ISO string — so a stale screen cannot lift a newer pause. */
  shownPausedAt: z.iso.datetime({ offset: true }),
});

export async function pauseOrderingAction(input: unknown): Promise<PauseOrderingActionResult> {
  const parsed = pauseSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: "INVALID_INPUT", error: parsed.error.issues[0]?.message ?? "That could not be saved." };

  try {
    const staff = await requirePermission("orders.update");
    const result = await pauseOrdering({ orgId: staff.orgId, actorUserId: staff.userId, reason: parsed.data.reason, mode: parsed.data.mode });
    if (result.ok) revalidateEverywhere();
    return result;
  } catch (error) {
    return failure(error);
  }
}

export async function resumeOrderingAction(input: unknown): Promise<ResumeOrderingActionResult> {
  const parsed = resumeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: "INVALID_INPUT", error: "That could not be saved. Reload and try again." };

  try {
    const staff = await requirePermission("orders.update");
    const result = await resumeOrdering({ orgId: staff.orgId, actorUserId: staff.userId, shownPausedAt: new Date(parsed.data.shownPausedAt) });
    // A PAUSE_CHANGED answer also changes what every screen should show.
    if (result.ok || result.code === "PAUSE_CHANGED") revalidateEverywhere();
    return result;
  } catch (error) {
    return failure(error);
  }
}

/**
 * The banner is on every customer page (owner requirement 2) and the state on
 * both staff controls, so the whole tree goes stale when the switch moves. The
 * server refusal in placeOrder does not depend on this: a page that is still
 * stale is refused at submit regardless.
 */
function revalidateEverywhere() {
  revalidatePath("/", "layout");
}

function failure(error: unknown): ActionFailure {
  unstable_rethrow(error);
  if (error instanceof NotSignedIn) return { ok: false, code: "SIGNED_OUT", error: "You've been signed out. Sign in again." };
  if (error instanceof NotPermitted) return { ok: false, code: "NOT_PERMITTED", error: "You don't have permission to switch online orders on or off." };
  console.error("shop-status-actions: switch failed", error instanceof Error ? error.name : "unknown");
  return { ok: false, code: "SERVER_ERROR", error: "That didn't save. Try again, and tell the owner if it keeps happening." };
}
