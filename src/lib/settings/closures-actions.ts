"use server";

/**
 * Admin → Restaurant: the weekly day off and the planned closed dates (ops-3).
 * `settings.manage` (OWNER only), re-checked here regardless of the page that
 * rendered the form (§41); the org is the signed-in staff member's own.
 *
 * Adding or removing a closure changes what the website says and what
 * `placeOrder` accepts, so it clears the same caches the Close Shop switch does.
 * The server gate does not depend on that: a stale page is refused at submit.
 */

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/lib/auth";
import { CLOSED_DATE_NOTE_MAX } from "@/lib/orders/closed-date-rules";
import { addClosedDate, removeClosedDate, setWeeklyClosedDays } from "@/lib/repositories/closed-dates";
import { clearMenuCache } from "@/lib/repositories/menu-cache";
import { type PreOrderRow, preOrderRows, savedMessage } from "./closures-copy";

export type ClosuresFormState =
  | { readonly status: "idle" }
  | { readonly status: "error"; readonly message: string }
  | { readonly status: "success"; readonly message: string; readonly preOrders: readonly PreOrderRow[] };

const DENIED = "You don't have permission to change restaurant settings.";

function refresh() {
  clearMenuCache();
  revalidatePath("/", "layout");
  revalidatePath("/app/admin/restaurant");
}

const weeklySchema = z.array(z.coerce.number().int().min(0).max(6)).max(6, "The shop has to be open at least one day a week.");

export async function saveWeeklyClosedDaysAction(_previous: ClosuresFormState, formData: FormData): Promise<ClosuresFormState> {
  let staff;
  try {
    staff = await requirePermission("settings.manage");
  } catch {
    return { status: "error", message: DENIED };
  }
  const parsed = weeklySchema.safeParse(formData.getAll("closedDay"));
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message ?? "Check the days." };

  const result = await setWeeklyClosedDays({ orgId: staff.orgId, actorUserId: staff.userId, days: parsed.data });
  if (!result.ok) return { status: "error", message: result.error };
  refresh();
  return { status: "success", message: savedMessage("Weekly days off", result.preOrders.length), preOrders: preOrderRows(result.preOrders) };
}

const addSchema = z.object({
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick the first day."),
  /** Blank means a single day. */
  endDate: z.string().regex(/^(\d{4}-\d{2}-\d{2})?$/, "Pick the last day."),
  note: z.string().trim().max(CLOSED_DATE_NOTE_MAX, `Keep the note under ${CLOSED_DATE_NOTE_MAX} characters.`),
});

export async function addClosedDateAction(_previous: ClosuresFormState, formData: FormData): Promise<ClosuresFormState> {
  let staff;
  try {
    staff = await requirePermission("settings.manage");
  } catch {
    return { status: "error", message: DENIED };
  }
  const parsed = addSchema.safeParse({
    startDate: String(formData.get("startDate") ?? ""),
    endDate: String(formData.get("endDate") ?? ""),
    note: String(formData.get("note") ?? ""),
  });
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message ?? "Check the form." };

  const result = await addClosedDate({
    orgId: staff.orgId,
    actorUserId: staff.userId,
    startDate: parsed.data.startDate,
    endDate: parsed.data.endDate || parsed.data.startDate,
    note: parsed.data.note === "" ? null : parsed.data.note,
  });
  if (!result.ok) return { status: "error", message: result.error };
  refresh();
  return { status: "success", message: savedMessage("Closed date", result.preOrders.length), preOrders: preOrderRows(result.preOrders) };
}

const removeSchema = z.object({ id: z.uuid() });

export async function removeClosedDateAction(_previous: ClosuresFormState, formData: FormData): Promise<ClosuresFormState> {
  let staff;
  try {
    staff = await requirePermission("settings.manage");
  } catch {
    return { status: "error", message: DENIED };
  }
  const parsed = removeSchema.safeParse({ id: String(formData.get("id") ?? "") });
  if (!parsed.success) return { status: "error", message: "That closed date could not be removed. Reload and try again." };

  const result = await removeClosedDate({ orgId: staff.orgId, actorUserId: staff.userId, id: parsed.data.id });
  if (!result.ok) return { status: "error", message: result.error };
  refresh();
  return { status: "success", message: "Closed date removed. The shop takes orders on those days again.", preOrders: [] };
}
