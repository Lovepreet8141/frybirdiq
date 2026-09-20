import "server-only";

/**
 * Basic shifts (roadmap 6.4): clock in, clock out, who is on now, a manager's
 * correction. Every query scopes by org_id; every write writes an audit row.
 *
 * Idempotency is the database's: a partial unique index allows one open shift
 * per person, so a double-tapped Clock in inserts once and the second tap finds
 * the open shift and returns it. Clocking out closes the open shift, and a
 * second tap finds none to close and says so.
 */

import { and, asc, desc, eq, gte, inArray, isNull, lte } from "drizzle-orm";
import { db } from "@/db";
import { auditLogs, memberships, shifts } from "@/db/schema";
import { businessDate } from "@/lib/dates";
import { SHIFT_NOTE_MAX } from "@/db/schema/shifts";
import { validateCorrection } from "@/lib/shifts/hours";

export interface ShiftRow {
  readonly id: string;
  readonly userId: string;
  readonly name: string;
  readonly businessDate: string;
  readonly clockInAt: Date;
  readonly clockOutAt: Date | null;
  readonly corrected: boolean;
}

const isUniqueViolation = (error: unknown) =>
  ((error as { code?: string; cause?: { code?: string } }).cause?.code ?? (error as { code?: string }).code) === "23505";

/** The one open shift for this person, if any. */
export async function getOpenShift(orgId: string, userId: string): Promise<{ id: string; clockInAt: Date } | null> {
  const [row] = await db()
    .select({ id: shifts.id, clockInAt: shifts.clockInAt })
    .from(shifts)
    .where(and(eq(shifts.orgId, orgId), eq(shifts.userId, userId), isNull(shifts.clockOutAt)))
    .limit(1);
  return row ?? null;
}

export type ClockInResult = { readonly ok: true; readonly shiftId: string; readonly alreadyOn: boolean; readonly clockInAt: Date };

/** Opens a shift for `userId`, or returns the one already open. Never two. */
export async function clockIn(orgId: string, userId: string, now: Date = new Date()): Promise<ClockInResult> {
  return db().transaction(async (tx) => {
    const [created] = await tx
      .insert(shifts)
      .values({ orgId, userId, clockInAt: now, businessDate: businessDate(now) })
      .onConflictDoNothing()
      .returning({ id: shifts.id, clockInAt: shifts.clockInAt });
    if (created) {
      await tx.insert(auditLogs).values({
        orgId,
        actorUserId: userId,
        action: "shift_clock_in",
        entity: "shifts",
        entityId: created.id,
        before: null,
        after: { clockInAt: now.toISOString() },
      });
      return { ok: true, shiftId: created.id, alreadyOn: false, clockInAt: created.clockInAt } as const;
    }
    const [open] = await tx
      .select({ id: shifts.id, clockInAt: shifts.clockInAt })
      .from(shifts)
      .where(and(eq(shifts.orgId, orgId), eq(shifts.userId, userId), isNull(shifts.clockOutAt)))
      .limit(1);
    if (!open) throw new Error("shifts: clock-in neither inserted nor found");
    return { ok: true, shiftId: open.id, alreadyOn: true, clockInAt: open.clockInAt } as const;
  });
}

export type ClockOutResult = { readonly ok: true; readonly shiftId: string; readonly alreadyOff: false } | { readonly ok: true; readonly alreadyOff: true };

/** Closes this person's open shift. With none open (a second tap) it changes nothing. */
export async function clockOut(orgId: string, userId: string, now: Date = new Date()): Promise<ClockOutResult> {
  return db().transaction(async (tx) => {
    const closed = await tx
      .update(shifts)
      .set({ clockOutAt: now })
      .where(and(eq(shifts.orgId, orgId), eq(shifts.userId, userId), isNull(shifts.clockOutAt)))
      .returning({ id: shifts.id, clockInAt: shifts.clockInAt });
    const row = closed[0];
    if (!row) return { ok: true, alreadyOff: true } as const;
    await tx.insert(auditLogs).values({
      orgId,
      actorUserId: userId,
      action: "shift_clock_out",
      entity: "shifts",
      entityId: row.id,
      before: { clockInAt: row.clockInAt.toISOString() },
      after: { clockOutAt: now.toISOString() },
    });
    return { ok: true, shiftId: row.id, alreadyOff: false } as const;
  });
}

async function namesFor(orgId: string, userIds: readonly string[]): Promise<Map<string, string>> {
  if (userIds.length === 0) return new Map();
  const rows = await db()
    .select({ userId: memberships.userId, displayName: memberships.displayName })
    .from(memberships)
    .where(and(eq(memberships.orgId, orgId), inArray(memberships.userId, [...userIds])));
  const names = new Map<string, string>();
  for (const row of rows) if (row.displayName && !names.has(row.userId)) names.set(row.userId, row.displayName);
  return names;
}

async function withNames(orgId: string, rows: readonly (typeof shifts.$inferSelect)[]): Promise<readonly ShiftRow[]> {
  const names = await namesFor(orgId, [...new Set(rows.map((r) => r.userId))]);
  return rows.map((r) => ({
    id: r.id,
    userId: r.userId,
    name: names.get(r.userId) ?? "Staff member",
    businessDate: r.businessDate,
    clockInAt: r.clockInAt,
    clockOutAt: r.clockOutAt,
    corrected: r.correctedAt !== null,
  }));
}

/** Everyone with an open shift right now, longest-standing first. */
export async function listOnShiftNow(orgId: string): Promise<readonly ShiftRow[]> {
  const rows = await db().select().from(shifts).where(and(eq(shifts.orgId, orgId), isNull(shifts.clockOutAt))).orderBy(asc(shifts.clockInAt));
  return withNames(orgId, rows);
}

/** Shifts that started on business dates from..to inclusive, newest first. */
export async function listShifts(orgId: string, from: string, to: string): Promise<readonly ShiftRow[]> {
  const rows = await db()
    .select()
    .from(shifts)
    .where(and(eq(shifts.orgId, orgId), gte(shifts.businessDate, from), lte(shifts.businessDate, to)))
    .orderBy(desc(shifts.clockInAt))
    .limit(1000);
  return withNames(orgId, rows);
}

export interface CorrectShiftInput {
  readonly orgId: string;
  readonly actorUserId: string;
  readonly shiftId: string;
  readonly clockInAt: Date;
  /** Null reopens the shift (only if the person has no other open one). */
  readonly clockOutAt: Date | null;
  readonly reason: string;
}

export type CorrectShiftResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: "not_found" | "invalid" | "other_open"; readonly message?: string };

/**
 * A manager's correction of a shift's times, with a required reason. The audit
 * row keeps before and after. The caller has already passed `staff.manage`.
 */
export async function correctShift(input: CorrectShiftInput, now: Date = new Date()): Promise<CorrectShiftResult> {
  const reason = input.reason.trim();
  if (reason.length < 1 || reason.length > SHIFT_NOTE_MAX) {
    return { ok: false, reason: "invalid", message: `Give a reason, up to ${SHIFT_NOTE_MAX} characters.` };
  }
  const check = validateCorrection(input.clockInAt, input.clockOutAt, now);
  if (!check.ok) return { ok: false, reason: "invalid", message: check.error };

  try {
    return await db().transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(shifts)
        .where(and(eq(shifts.orgId, input.orgId), eq(shifts.id, input.shiftId)))
        .for("update")
        .limit(1);
      if (!current) return { ok: false, reason: "not_found" } as const;

      await tx
        .update(shifts)
        .set({
          clockInAt: input.clockInAt,
          clockOutAt: input.clockOutAt,
          businessDate: businessDate(input.clockInAt),
          correctedBy: input.actorUserId,
          correctedAt: now,
          note: reason,
        })
        .where(and(eq(shifts.orgId, input.orgId), eq(shifts.id, input.shiftId)));

      await tx.insert(auditLogs).values({
        orgId: input.orgId,
        actorUserId: input.actorUserId,
        action: "shift_corrected",
        entity: "shifts",
        entityId: input.shiftId,
        before: { userId: current.userId, clockInAt: current.clockInAt.toISOString(), clockOutAt: current.clockOutAt?.toISOString() ?? null },
        after: { clockInAt: input.clockInAt.toISOString(), clockOutAt: input.clockOutAt?.toISOString() ?? null, reason },
      });
      return { ok: true } as const;
    });
  } catch (error) {
    // Reopening a shift while the person has another one open.
    if (isUniqueViolation(error)) return { ok: false, reason: "other_open" };
    throw error;
  }
}
