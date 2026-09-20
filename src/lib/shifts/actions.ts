"use server";

/**
 * Shifts (roadmap 6.4). A person clocks only themselves: the user id comes
 * from the session, never the form, so no one can clock another in. Any signed
 * in staff member may clock themselves (an owner too). Correcting a shift is
 * `staff.manage`, re-checked here (§41).
 */

import { revalidatePath } from "next/cache";
import { requirePermission, requireStaff } from "@/lib/auth";
import { clockIn, clockOut, correctBreak, correctShift, endBreak, startBreak } from "@/lib/repositories/shifts";
import { parseIstLocal } from "./hours";

export type ShiftActionState = { status: "idle" } | { status: "error"; message: string } | { status: "success"; message: string };

const NOT_SIGNED_IN = "Sign in again to clock in or out.";
const FAILED = "Couldn't save. Check the connection and try again.";

export async function clockInAction(_previous: ShiftActionState, _formData: FormData): Promise<ShiftActionState> {
  let staff;
  try {
    staff = await requireStaff();
  } catch {
    return { status: "error", message: NOT_SIGNED_IN };
  }
  try {
    const result = await clockIn(staff.orgId, staff.userId);
    revalidatePath("/app/staff/shifts");
    return { status: "success", message: result.alreadyOn ? "You were already clocked in." : "Clocked in." };
  } catch {
    return { status: "error", message: FAILED };
  }
}

export async function clockOutAction(_previous: ShiftActionState, _formData: FormData): Promise<ShiftActionState> {
  let staff;
  try {
    staff = await requireStaff();
  } catch {
    return { status: "error", message: NOT_SIGNED_IN };
  }
  try {
    const result = await clockOut(staff.orgId, staff.userId);
    revalidatePath("/app/staff/shifts");
    return { status: "success", message: result.alreadyOff ? "You were not clocked in." : "Clocked out." };
  } catch {
    return { status: "error", message: FAILED };
  }
}

export async function correctShiftAction(_previous: ShiftActionState, formData: FormData): Promise<ShiftActionState> {
  let staff;
  try {
    staff = await requirePermission("staff.manage");
  } catch {
    return { status: "error", message: "You don't have permission to correct shifts." };
  }
  const field = (name: string) => String(formData.get(name) ?? "");
  const clockInAt = parseIstLocal(field("clockIn"));
  if (!clockInAt) return { status: "error", message: "Enter the clock-in time." };
  const outRaw = field("clockOut");
  const clockOutAt = outRaw === "" ? null : parseIstLocal(outRaw);
  if (outRaw !== "" && !clockOutAt) return { status: "error", message: "That clock-out time isn't valid." };

  try {
    const result = await correctShift({
      orgId: staff.orgId,
      actorUserId: staff.userId,
      shiftId: field("shiftId"),
      clockInAt,
      clockOutAt,
      reason: field("reason"),
    });
    if (!result.ok) {
      const message =
        result.reason === "not_found"
          ? "That shift no longer exists."
          : result.reason === "other_open"
            ? "This person is clocked in on another shift. Clock them out first."
            : (result.message ?? "Check the times.");
      return { status: "error", message };
    }
  } catch {
    return { status: "error", message: FAILED };
  }
  revalidatePath("/app/staff/shifts");
  return { status: "success", message: "Shift corrected." };
}

export async function startBreakAction(_previous: ShiftActionState, _formData: FormData): Promise<ShiftActionState> {
  let staff;
  try {
    staff = await requireStaff();
  } catch {
    return { status: "error", message: NOT_SIGNED_IN };
  }
  try {
    const result = await startBreak(staff.orgId, staff.userId);
    if (!result.ok) return { status: "error", message: "Clock in before starting a break." };
    revalidatePath("/app/staff/shifts");
    return { status: "success", message: result.alreadyOn ? "You were already on a break." : "Break started." };
  } catch {
    return { status: "error", message: FAILED };
  }
}

export async function endBreakAction(_previous: ShiftActionState, _formData: FormData): Promise<ShiftActionState> {
  let staff;
  try {
    staff = await requireStaff();
  } catch {
    return { status: "error", message: NOT_SIGNED_IN };
  }
  try {
    const result = await endBreak(staff.orgId, staff.userId);
    revalidatePath("/app/staff/shifts");
    return { status: "success", message: result.alreadyOff ? "You were not on a break." : "Break ended." };
  } catch {
    return { status: "error", message: FAILED };
  }
}

export async function correctBreakAction(_previous: ShiftActionState, formData: FormData): Promise<ShiftActionState> {
  let staff;
  try {
    staff = await requirePermission("staff.manage");
  } catch {
    return { status: "error", message: "You don't have permission to correct breaks." };
  }
  const field = (name: string) => String(formData.get(name) ?? "");
  const startedAt = parseIstLocal(field("start"));
  if (!startedAt) return { status: "error", message: "Enter the break start time." };
  const endRaw = field("end");
  const endedAt = endRaw === "" ? null : parseIstLocal(endRaw);
  if (endRaw !== "" && !endedAt) return { status: "error", message: "That break end time isn't valid." };
  try {
    const result = await correctBreak({ orgId: staff.orgId, actorUserId: staff.userId, breakId: field("breakId"), startedAt, endedAt, reason: field("reason") });
    if (!result.ok) {
      const message =
        result.reason === "not_found" ? "That break no longer exists." : result.reason === "other_open" ? "Another break on this shift is still open." : (result.message ?? "Check the times.");
      return { status: "error", message };
    }
  } catch {
    return { status: "error", message: FAILED };
  }
  revalidatePath("/app/staff/shifts");
  return { status: "success", message: "Break corrected." };
}
