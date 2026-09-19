import "server-only";

/**
 * Planned closures (ops-3): the weekly off day and the closed-dates list.
 *
 * READS feed the ordering gate (`shopStatusFromOrg`), so they are scoped by
 * org_id like every repository query and take an executor: the write gate reads
 * them inside the order's own locked transaction.
 *
 * WRITES lock the organization row FOR UPDATE, the same row `persistOrder`
 * holds FOR SHARE while it re-decides the gate. So a closure and an order
 * cannot pass each other: an order in flight finishes first and the closure
 * then LISTS it, or the closure commits first and the order is refused at
 * write. The affected pre-orders are read inside that same locked transaction,
 * which is what makes the list the owner is shown complete. Nothing here ever
 * cancels or changes an order.
 *
 * Every change is one audit row, in the transaction.
 */

import { and, asc, eq, gte, isNotNull, lte, notInArray } from "drizzle-orm";
import { db } from "@/db";
import { auditLogs, closedDates, orders, organizations } from "@/db/schema";
import { TERMINAL_STATUSES } from "@/domain/order-status";
import { addDays, businessDate } from "@/lib/dates";
import { CLOSED_DATE_MAX_ROWS, closedDateProblem } from "@/lib/orders/closed-date-rules";
import { type ClosedDateRange, type Closures, closedDay, normaliseWeekdays, weekdayOf } from "@/lib/orders/closures";

type Executor = Pick<ReturnType<typeof db>, "select">;

export interface ClosedDateRow extends ClosedDateRange {
  readonly id: string;
}

/**
 * The closed dates that can still matter: those not ended before yesterday
 * (yesterday's, for a session that runs past midnight). The ordering gate reads
 * this on every order and every page, so it never pulls the whole history.
 */
export async function readClosedDates(orgId: string, now: Date, executor: Executor = db()): Promise<ClosedDateRow[]> {
  const rows = await executor
    .select({ id: closedDates.id, startDate: closedDates.startDate, endDate: closedDates.endDate, note: closedDates.publicNote })
    .from(closedDates)
    .where(and(eq(closedDates.orgId, orgId), gte(closedDates.endDate, addDays(businessDate(now), -1))))
    .orderBy(asc(closedDates.startDate));
  return rows;
}

/* ------------------------------------------------------- pre-order impact */

/** Statuses that mean the order is still going to be made: not finished, not a draft. PENDING_PAYMENT counts (the customer is waiting). */
const OPEN_STATUSES_EXCLUDED = [...TERMINAL_STATUSES, "DRAFT"] as const;

/** Pre-orders are only offered a day or two ahead; a month is far more than enough and keeps the query bounded. */
const PRE_ORDER_LOOKAHEAD_DAYS = 45;

export interface AffectedPreOrder {
  readonly orderId: string;
  readonly orderNumber: string;
  readonly customerName: string | null;
  readonly scheduledFor: Date;
  /** The business date it is booked for. */
  readonly date: string;
  readonly status: string;
  /** Why that date is closed: the owner's note, or null. */
  readonly note: string | null;
}

/**
 * Pre-orders already booked for a closed day: not finished, scheduled from now
 * on, and falling on a date `closures` closes. Read-only; the owner decides
 * what to do with each one. Bounded to a month ahead: pre-orders are only
 * offered a day or two out.
 */
export async function findPreOrdersOnClosedDays(orgId: string, closures: Closures, now: Date, executor: Executor = db()): Promise<AffectedPreOrder[]> {
  if (closures.weeklyClosedDays.length === 0 && closures.closedDates.length === 0) return [];
  const rows = await executor
    .select({
      orderId: orders.id,
      orderNumber: orders.orderNumber,
      customerName: orders.customerName,
      scheduledFor: orders.scheduledFor,
      status: orders.status,
    })
    .from(orders)
    .where(
      and(
        eq(orders.orgId, orgId),
        isNotNull(orders.scheduledFor),
        gte(orders.scheduledFor, now),
        lte(orders.scheduledFor, new Date(now.getTime() + PRE_ORDER_LOOKAHEAD_DAYS * 86_400_000)),
        notInArray(orders.status, [...OPEN_STATUSES_EXCLUDED]),
      ),
    )
    .orderBy(asc(orders.scheduledFor))
    .limit(2000);
  const affected: AffectedPreOrder[] = [];
  for (const row of rows) {
    if (!row.scheduledFor) continue;
    const date = businessDate(row.scheduledFor);
    const closed = closedDay(date, closures);
    if (!closed) continue;
    affected.push({ orderId: row.orderId, orderNumber: row.orderNumber, customerName: row.customerName, scheduledFor: row.scheduledFor, date, status: row.status, note: closed.note });
  }
  return affected;
}

/* ------------------------------------------------------------------ reads */

export interface ClosuresOverview {
  readonly weeklyClosedDays: readonly number[];
  readonly closedDates: readonly ClosedDateRow[];
  readonly preOrdersOnClosedDays: readonly AffectedPreOrder[];
}

/** Everything the Admin panel shows, from one read of the org row and the list. */
export async function getClosuresOverview(orgId: string, now: Date = new Date()): Promise<ClosuresOverview | null> {
  const [org] = await db().select({ weekly: organizations.weeklyClosedDays }).from(organizations).where(eq(organizations.id, orgId)).limit(1);
  if (!org) return null;
  const dates = await readClosedDates(orgId, now);
  const weeklyClosedDays = normaliseWeekdays(org.weekly);
  const preOrdersOnClosedDays = await findPreOrdersOnClosedDays(orgId, { weeklyClosedDays, closedDates: dates }, now);
  return { weeklyClosedDays, closedDates: dates, preOrdersOnClosedDays };
}

/* ----------------------------------------------------------------- writes */

export type ClosureWriteResult =
  | { readonly ok: true; readonly preOrders: readonly AffectedPreOrder[] }
  | { readonly ok: false; readonly code: "INVALID" | "NOT_FOUND"; readonly error: string };

export interface AddClosedDateInput {
  readonly orgId: string;
  readonly actorUserId: string;
  readonly startDate: string;
  readonly endDate: string;
  readonly note: string | null;
  readonly now?: Date;
}

/**
 * Adds a closed date (or run of dates) and reports the pre-orders it lands on.
 * The row is written even when there are pre-orders — the owner asked for the
 * list, not a refusal — and none of them is touched.
 */
export async function addClosedDate(input: AddClosedDateInput): Promise<ClosureWriteResult> {
  const now = input.now ?? new Date();
  const problem = closedDateProblem(input.startDate, input.endDate, input.note, businessDate(now));
  if (problem) return { ok: false, code: "INVALID", error: problem };

  return db().transaction(async (tx) => {
    const [org] = await tx.select({ weekly: organizations.weeklyClosedDays }).from(organizations).where(eq(organizations.id, input.orgId)).for("update").limit(1);
    if (!org) return { ok: false, code: "NOT_FOUND", error: "That shop could not be found." } as const;

    const existing = await tx
      .select({ id: closedDates.id, startDate: closedDates.startDate, endDate: closedDates.endDate, note: closedDates.publicNote })
      .from(closedDates)
      .where(and(eq(closedDates.orgId, input.orgId), gte(closedDates.endDate, businessDate(now))));
    // A double-submit or a second tab: the same closure again changes nothing (no duplicate row, no second audit row).
    if (existing.some((row) => row.startDate === input.startDate && row.endDate === input.endDate && row.note === input.note)) {
      const dates = await readClosedDates(input.orgId, now, tx);
      const preOrders = await findPreOrdersOnClosedDays(input.orgId, { weeklyClosedDays: normaliseWeekdays(org.weekly), closedDates: dates }, now, tx);
      return { ok: true, preOrders: preOrders.filter((order) => order.date >= input.startDate && order.date <= input.endDate) } as const;
    }
    if (existing.length >= CLOSED_DATE_MAX_ROWS) return { ok: false, code: "INVALID", error: `There are already ${CLOSED_DATE_MAX_ROWS} planned closures. Remove some that have finished.` } as const;

    const [row] = await tx
      .insert(closedDates)
      .values({ orgId: input.orgId, startDate: input.startDate, endDate: input.endDate, publicNote: input.note, createdBy: input.actorUserId })
      .returning({ id: closedDates.id });

    await tx.insert(auditLogs).values({
      orgId: input.orgId,
      actorUserId: input.actorUserId,
      action: "closed_date_added",
      entity: "closed_dates",
      entityId: row?.id ?? input.orgId,
      before: null,
      after: { startDate: input.startDate, endDate: input.endDate, note: input.note },
    });

    const dates = await readClosedDates(input.orgId, now, tx);
    const preOrders = await findPreOrdersOnClosedDays(input.orgId, { weeklyClosedDays: normaliseWeekdays(org.weekly), closedDates: dates }, now, tx);
    return { ok: true, preOrders: preOrders.filter((order) => order.date >= input.startDate && order.date <= input.endDate) } as const;
  });
}

export async function removeClosedDate(input: { readonly orgId: string; readonly actorUserId: string; readonly id: string; readonly now?: Date }): Promise<ClosureWriteResult> {
  return db().transaction(async (tx) => {
    // Locked like the add, so a removal and an order in flight cannot pass each other.
    await tx.select({ id: organizations.id }).from(organizations).where(eq(organizations.id, input.orgId)).for("update").limit(1);
    const [removed] = await tx
      .delete(closedDates)
      .where(and(eq(closedDates.orgId, input.orgId), eq(closedDates.id, input.id)))
      .returning({ startDate: closedDates.startDate, endDate: closedDates.endDate, note: closedDates.publicNote });
    if (!removed) return { ok: false, code: "NOT_FOUND", error: "That closed date was already removed." } as const;
    await tx.insert(auditLogs).values({
      orgId: input.orgId,
      actorUserId: input.actorUserId,
      action: "closed_date_removed",
      entity: "closed_dates",
      entityId: input.id,
      before: { startDate: removed.startDate, endDate: removed.endDate, note: removed.note },
      after: null,
    });
    return { ok: true, preOrders: [] } as const;
  });
}

/**
 * Sets the weekly closed days ("Closed all day"). At most six: a shop closed on
 * every weekday has no next opening. Returns the pre-orders now sitting on a
 * closed weekday, none of them touched.
 */
export async function setWeeklyClosedDays(input: { readonly orgId: string; readonly actorUserId: string; readonly days: readonly number[]; readonly now?: Date }): Promise<ClosureWriteResult> {
  const now = input.now ?? new Date();
  const days = normaliseWeekdays(input.days);
  if (days.length !== new Set(input.days).size) return { ok: false, code: "INVALID", error: "Pick weekdays only." };
  if (days.length > 6) return { ok: false, code: "INVALID", error: "The shop has to be open at least one day a week." };

  return db().transaction(async (tx) => {
    const [org] = await tx.select({ weekly: organizations.weeklyClosedDays }).from(organizations).where(eq(organizations.id, input.orgId)).for("update").limit(1);
    if (!org) return { ok: false, code: "NOT_FOUND", error: "That shop could not be found." } as const;
    const before = normaliseWeekdays(org.weekly);
    if (before.join() === days.join()) return { ok: true, preOrders: [] } as const;

    await tx.update(organizations).set({ weeklyClosedDays: days, updatedAt: now }).where(eq(organizations.id, input.orgId));
    await tx.insert(auditLogs).values({
      orgId: input.orgId,
      actorUserId: input.actorUserId,
      action: "weekly_closed_days_changed",
      entity: "organizations",
      entityId: input.orgId,
      before: { weeklyClosedDays: before },
      after: { weeklyClosedDays: days },
    });
    const dates = await readClosedDates(input.orgId, now, tx);
    const newlyClosed = days.filter((day) => !before.includes(day));
    const preOrders = await findPreOrdersOnClosedDays(input.orgId, { weeklyClosedDays: days, closedDates: dates }, now, tx);
    return { ok: true, preOrders: preOrders.filter((order) => newlyClosed.includes(weekdayOf(order.date))) } as const;
  });
}
