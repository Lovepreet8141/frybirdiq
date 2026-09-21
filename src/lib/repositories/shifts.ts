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

import { and, asc, desc, eq, gte, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { auditLogs, cashSessions, memberships, shiftBreaks, shifts } from "@/db/schema";
import { businessDate } from "@/lib/dates";
import { SHIFT_NOTE_MAX } from "@/db/schema/shifts";
import { type BreakSpan, validateBreakCorrection, validateCorrection } from "@/lib/shifts/hours";
import { paise, type Paise } from "@/lib/money";

export interface ShiftRow {
  readonly id: string;
  readonly userId: string;
  readonly name: string;
  readonly businessDate: string;
  readonly clockInAt: Date;
  readonly clockOutAt: Date | null;
  readonly corrected: boolean;
  readonly breaks: readonly (BreakSpan & { readonly id: string })[];
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
    // The table requires clock_out_at > clock_in_at. A clock-out in the very same millisecond as the clock-in (a double
    // tap, or two clocks a few ms apart) would violate it and fail; the shift is closed one millisecond after it began instead.
    const closed = await tx
      .update(shifts)
      .set({ clockOutAt: sql`greatest(${now.toISOString()}::timestamptz, ${shifts.clockInAt} + interval '1 millisecond')` })
      .where(and(eq(shifts.orgId, orgId), eq(shifts.userId, userId), isNull(shifts.clockOutAt)))
      .returning({ id: shifts.id, clockInAt: shifts.clockInAt, clockOutAt: shifts.clockOutAt });
    const row = closed[0];
    if (!row) return { ok: true, alreadyOff: true } as const;
    const out = row.clockOutAt ?? now;
    // A break still open at clock-out ends at the same instant.
    const [openBreak] = await tx
      .select({ id: shiftBreaks.id, startedAt: shiftBreaks.startedAt })
      .from(shiftBreaks)
      .where(and(eq(shiftBreaks.orgId, orgId), eq(shiftBreaks.shiftId, row.id), isNull(shiftBreaks.endedAt)))
      .limit(1);
    if (openBreak) {
      await tx.update(shiftBreaks).set({ endedAt: out }).where(and(eq(shiftBreaks.orgId, orgId), eq(shiftBreaks.id, openBreak.id)));
      await tx.insert(auditLogs).values({
        orgId,
        actorUserId: userId,
        action: "shift_break_ended",
        entity: "shift_breaks",
        entityId: openBreak.id,
        before: { startedAt: openBreak.startedAt.toISOString() },
        after: { endedAt: out.toISOString(), closedByClockOut: true },
      });
    }
    await tx.insert(auditLogs).values({
      orgId,
      actorUserId: userId,
      action: "shift_clock_out",
      entity: "shifts",
      entityId: row.id,
      before: { clockInAt: row.clockInAt.toISOString() },
      after: { clockOutAt: out.toISOString() },
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
  const breakRows =
    rows.length === 0
      ? []
      : await db()
          .select()
          .from(shiftBreaks)
          .where(and(eq(shiftBreaks.orgId, orgId), inArray(shiftBreaks.shiftId, rows.map((r) => r.id))))
          .orderBy(asc(shiftBreaks.startedAt));
  return rows.map((r) => ({
    id: r.id,
    userId: r.userId,
    name: names.get(r.userId) ?? "Staff member",
    businessDate: r.businessDate,
    clockInAt: r.clockInAt,
    clockOutAt: r.clockOutAt,
    corrected: r.correctedAt !== null,
    breaks: breakRows.filter((b) => b.shiftId === r.id).map((b) => ({ id: b.id, startedAt: b.startedAt, endedAt: b.endedAt })),
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

/* ------------------------------------------------------------------ */
/* Breaks                                                              */
/* ------------------------------------------------------------------ */

export type StartBreakResult =
  | { readonly ok: true; readonly breakId: string; readonly alreadyOn: boolean }
  | { readonly ok: false; readonly reason: "no_shift" };

/** Starts a break on this person's open shift, or returns the one already open. Never two. */
export async function startBreak(orgId: string, userId: string, now: Date = new Date()): Promise<StartBreakResult> {
  return db().transaction(async (tx) => {
    const [shift] = await tx
      .select({ id: shifts.id })
      .from(shifts)
      .where(and(eq(shifts.orgId, orgId), eq(shifts.userId, userId), isNull(shifts.clockOutAt)))
      .limit(1);
    if (!shift) return { ok: false, reason: "no_shift" } as const;

    const [created] = await tx
      .insert(shiftBreaks)
      .values({ orgId, shiftId: shift.id, startedAt: now })
      .onConflictDoNothing()
      .returning({ id: shiftBreaks.id });
    if (created) {
      await tx.insert(auditLogs).values({
        orgId,
        actorUserId: userId,
        action: "shift_break_started",
        entity: "shift_breaks",
        entityId: created.id,
        before: null,
        after: { shiftId: shift.id, startedAt: now.toISOString() },
      });
      return { ok: true, breakId: created.id, alreadyOn: false } as const;
    }
    const [open] = await tx
      .select({ id: shiftBreaks.id })
      .from(shiftBreaks)
      .where(and(eq(shiftBreaks.orgId, orgId), eq(shiftBreaks.shiftId, shift.id), isNull(shiftBreaks.endedAt)))
      .limit(1);
    if (!open) throw new Error("shifts: break neither inserted nor found");
    return { ok: true, breakId: open.id, alreadyOn: true } as const;
  });
}

export type EndBreakResult = { readonly ok: true; readonly alreadyOff: boolean };

/** Ends this person's open break. With none open (a second tap) it changes nothing. */
export async function endBreak(orgId: string, userId: string, now: Date = new Date()): Promise<EndBreakResult> {
  return db().transaction(async (tx) => {
    const [open] = await tx
      .select({ id: shiftBreaks.id, startedAt: shiftBreaks.startedAt })
      .from(shiftBreaks)
      .innerJoin(shifts, eq(shifts.id, shiftBreaks.shiftId))
      .where(and(eq(shiftBreaks.orgId, orgId), eq(shifts.orgId, orgId), eq(shifts.userId, userId), isNull(shiftBreaks.endedAt)))
      .for("update", { of: shiftBreaks })
      .limit(1);
    if (!open) return { ok: true, alreadyOff: true } as const;
    // Ended strictly after it started, even on a same-millisecond tap.
    const endedAt = now.getTime() > open.startedAt.getTime() ? now : new Date(open.startedAt.getTime() + 1);
    await tx.update(shiftBreaks).set({ endedAt }).where(and(eq(shiftBreaks.orgId, orgId), eq(shiftBreaks.id, open.id)));
    await tx.insert(auditLogs).values({
      orgId,
      actorUserId: userId,
      action: "shift_break_ended",
      entity: "shift_breaks",
      entityId: open.id,
      before: { startedAt: open.startedAt.toISOString() },
      after: { endedAt: endedAt.toISOString() },
    });
    return { ok: true, alreadyOff: false } as const;
  });
}

/** Whether this person is on a break right now. */
export async function getOpenBreak(orgId: string, userId: string): Promise<{ id: string; startedAt: Date } | null> {
  const [row] = await db()
    .select({ id: shiftBreaks.id, startedAt: shiftBreaks.startedAt })
    .from(shiftBreaks)
    .innerJoin(shifts, eq(shifts.id, shiftBreaks.shiftId))
    .where(and(eq(shiftBreaks.orgId, orgId), eq(shifts.orgId, orgId), eq(shifts.userId, userId), isNull(shiftBreaks.endedAt)))
    .limit(1);
  return row ?? null;
}

export interface CorrectBreakInput {
  readonly orgId: string;
  readonly actorUserId: string;
  readonly breakId: string;
  readonly startedAt: Date;
  /** Null keeps the break open (only on an open shift). */
  readonly endedAt: Date | null;
  readonly reason: string;
}

export type CorrectBreakResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: "not_found" | "invalid" | "overlap" | "other_open"; readonly message?: string };

/** A manager's correction of one break's times, with a required reason and an audit row. The caller has passed `staff.manage`. */
export async function correctBreak(input: CorrectBreakInput, now: Date = new Date()): Promise<CorrectBreakResult> {
  const reason = input.reason.trim();
  if (reason.length < 1 || reason.length > SHIFT_NOTE_MAX) {
    return { ok: false, reason: "invalid", message: `Give a reason, up to ${SHIFT_NOTE_MAX} characters.` };
  }
  try {
    return await db().transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(shiftBreaks)
        .where(and(eq(shiftBreaks.orgId, input.orgId), eq(shiftBreaks.id, input.breakId)))
        .for("update")
        .limit(1);
      if (!current) return { ok: false, reason: "not_found" } as const;
      const [shift] = await tx
        .select()
        .from(shifts)
        .where(and(eq(shifts.orgId, input.orgId), eq(shifts.id, current.shiftId)))
        .limit(1);
      if (!shift) return { ok: false, reason: "not_found" } as const;

      const check = validateBreakCorrection(shift, input.startedAt, input.endedAt, now);
      if (!check.ok) return { ok: false, reason: "invalid", message: check.error } as const;

      const others = await tx
        .select({ startedAt: shiftBreaks.startedAt, endedAt: shiftBreaks.endedAt })
        .from(shiftBreaks)
        .where(and(eq(shiftBreaks.orgId, input.orgId), eq(shiftBreaks.shiftId, current.shiftId)));
      const start = input.startedAt.getTime();
      const end = (input.endedAt ?? now).getTime();
      const clash = others.some(
        (o) => !(o.startedAt.getTime() === current.startedAt.getTime()) && o.startedAt.getTime() < end && (o.endedAt ?? now).getTime() > start,
      );
      if (clash) return { ok: false, reason: "overlap", message: "That overlaps another break on this shift." } as const;

      await tx
        .update(shiftBreaks)
        .set({ startedAt: input.startedAt, endedAt: input.endedAt, correctedBy: input.actorUserId, correctedAt: now, note: reason })
        .where(and(eq(shiftBreaks.orgId, input.orgId), eq(shiftBreaks.id, input.breakId)));
      await tx.insert(auditLogs).values({
        orgId: input.orgId,
        actorUserId: input.actorUserId,
        action: "shift_break_corrected",
        entity: "shift_breaks",
        entityId: input.breakId,
        before: { startedAt: current.startedAt.toISOString(), endedAt: current.endedAt?.toISOString() ?? null },
        after: { startedAt: input.startedAt.toISOString(), endedAt: input.endedAt?.toISOString() ?? null, reason },
      });
      return { ok: true } as const;
    });
  } catch (error) {
    if (isUniqueViolation(error)) return { ok: false, reason: "other_open" };
    throw error;
  }
}

/* ------------------------------------------------------------------ */
/* Till sessions seen from a shift (read-only, no coupling)             */
/* ------------------------------------------------------------------ */

export interface ShiftTillSession {
  readonly sessionId: string;
  /** What this person did to the till during the shift. */
  readonly action: "opened" | "closed";
  readonly at: Date;
  /** Present only when the caller asked for figures (the viewer holds finance.view). */
  readonly figures?: { readonly counted: Paise; readonly expected: Paise; readonly variance: Paise };
}

/**
 * The till sessions `userId` opened or closed between `from` and `to`. Times
 * only unless `includeFigures`: the counted, expected and variance figures are
 * the till's and belong to `finance.view`. Reading this never requires, creates
 * or changes a shift or a session.
 */
export async function listTillSessionsDuring(
  orgId: string,
  userId: string,
  from: Date,
  to: Date,
  includeFigures = false,
): Promise<readonly ShiftTillSession[]> {
  const rows = await db()
    .select()
    .from(cashSessions)
    .where(
      and(
        eq(cashSessions.orgId, orgId),
        or(
          and(eq(cashSessions.openedBy, userId), gte(cashSessions.openedAt, from), lte(cashSessions.openedAt, to)),
          and(eq(cashSessions.closedBy, userId), gte(cashSessions.closedAt, from), lte(cashSessions.closedAt, to)),
        ),
      ),
    )
    .orderBy(asc(cashSessions.openedAt));

  const out: ShiftTillSession[] = [];
  for (const row of rows) {
    const figures =
      includeFigures && row.countedCash !== null && row.expectedCash !== null && row.variance !== null
        ? { counted: paise(row.countedCash), expected: paise(row.expectedCash), variance: paise(row.variance) }
        : undefined;
    if (row.openedBy === userId && row.openedAt >= from && row.openedAt <= to) {
      out.push({ sessionId: row.id, action: "opened", at: row.openedAt });
    }
    if (row.closedBy === userId && row.closedAt && row.closedAt >= from && row.closedAt <= to) {
      out.push({ sessionId: row.id, action: "closed", at: row.closedAt, ...(figures ? { figures } : {}) });
    }
  }
  return out.sort((a, b) => a.at.getTime() - b.at.getTime());
}
