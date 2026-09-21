import "server-only";

/**
 * The till (roadmap 5.1-5.3): open a cash session with a float, close it with a
 * count, take a rider's door cash into it, and read the day back.
 *
 * Every figure is a sum over stored rows, never a remembered number:
 *  - cash TAKEN in a session is Σ payments.amount of CASH payments whose
 *    `cash_session_id` is that session (a payment attaches to the open session in
 *    the same transaction that captures it, `settle`);
 *  - cash REFUNDED out of it is Σ refunds (provider cash, SUCCEEDED) finalised
 *    while the session was open;
 *  - expected = float + taken - refunded (`expectedCash`), computed inside the
 *    closing transaction and stored as a snapshot beside the counted figure.
 *
 * Locking. A cash payment reads the open session FOR SHARE; closing takes it
 * FOR UPDATE. So a payment in flight finishes before the close counts, and a
 * payment that starts after the close committed finds no open session and
 * attaches to none: no payment is ever added to a session that is already
 * closed, and none slips past the count.
 *
 * Every query scopes by org_id itself. Every change writes an audit row in its
 * transaction, against the person who did it. Money is integer paise.
 */

import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { auditLogs, cashHandovers, cashSessions, memberships, payments, refunds } from "@/db/schema";
import { type Paise, ZERO, add, paise, subtract } from "@/lib/money";
import { businessDate } from "@/lib/dates";
import { expectedCash, varianceOf } from "@/lib/cash/session";
import { getStoreLocationId } from "./hardware";

type Executor = Pick<ReturnType<typeof db>, "select">;

/** Payment statuses meaning cash was taken (a refund does not un-take it; refunds are counted separately). */
const CASH_TAKEN_STATUSES = ["CAPTURED", "PARTIALLY_REFUNDED", "REFUNDED"] as const;

/* ------------------------------------------------------------------ */
/* Attaching a payment                                                 */
/* ------------------------------------------------------------------ */

/**
 * The session a counter cash payment attaches to, or null when no till is open.
 * Read FOR SHARE, inside the payment's own transaction (see the file header).
 */
export async function openSessionIdForPayment(tx: Executor, orgId: string, locationId: string): Promise<string | null> {
  const [row] = await tx
    .select({ id: cashSessions.id })
    .from(cashSessions)
    .where(and(eq(cashSessions.orgId, orgId), eq(cashSessions.locationId, locationId), eq(cashSessions.status, "OPEN")))
    .for("share")
    .limit(1);
  return row?.id ?? null;
}

/* ------------------------------------------------------------------ */
/* Reads                                                               */
/* ------------------------------------------------------------------ */

export interface CashSessionView {
  readonly id: string;
  readonly status: "OPEN" | "CLOSED";
  readonly openedAt: Date;
  readonly openedBy: { readonly userId: string; readonly name: string | null };
  readonly openingFloat: Paise;
  /** How many cash payments are in it right now. The amount is NOT shown while open: the count stays blind. */
  readonly cashPaymentCount: number;
  readonly closedAt: Date | null;
  readonly closedBy: { readonly userId: string; readonly name: string | null } | null;
  /** Present only once closed. */
  readonly countedCash: Paise | null;
  readonly expectedCash: Paise | null;
  readonly variance: Paise | null;
  readonly note: string | null;
}

async function namesFor(orgId: string, userIds: readonly string[]): Promise<Map<string, string | null>> {
  const unique = [...new Set(userIds)];
  if (unique.length === 0) return new Map();
  const rows = await db()
    .select({ userId: memberships.userId, displayName: memberships.displayName })
    .from(memberships)
    .where(and(eq(memberships.orgId, orgId), inArray(memberships.userId, unique)));
  const names = new Map<string, string | null>();
  for (const row of rows) if (row.displayName && !names.get(row.userId)) names.set(row.userId, row.displayName);
  for (const id of unique) if (!names.has(id)) names.set(id, null);
  return names;
}

function view(row: typeof cashSessions.$inferSelect, count: number, names: Map<string, string | null>): CashSessionView {
  return {
    id: row.id,
    status: row.status,
    openedAt: row.openedAt,
    openedBy: { userId: row.openedBy, name: names.get(row.openedBy) ?? null },
    openingFloat: paise(row.openingFloat),
    cashPaymentCount: count,
    closedAt: row.closedAt,
    closedBy: row.closedBy ? { userId: row.closedBy, name: names.get(row.closedBy) ?? null } : null,
    countedCash: row.countedCash === null ? null : paise(row.countedCash),
    expectedCash: row.expectedCash === null ? null : paise(row.expectedCash),
    variance: row.variance === null ? null : paise(row.variance),
    note: row.note,
  };
}

async function paymentCounts(orgId: string, sessionIds: readonly string[]): Promise<Map<string, number>> {
  if (sessionIds.length === 0) return new Map();
  const rows = await db()
    .select({ sessionId: payments.cashSessionId, n: sql<number>`count(*)::int` })
    .from(payments)
    .where(and(eq(payments.orgId, orgId), inArray(payments.cashSessionId, [...sessionIds]), eq(payments.method, "CASH"), inArray(payments.status, [...CASH_TAKEN_STATUSES])))
    .groupBy(payments.cashSessionId);
  return new Map(rows.map((r) => [r.sessionId!, r.n]));
}

export interface CashSessionsOverview {
  readonly open: CashSessionView | null;
  /** The most recent closed sessions, newest first. */
  readonly recent: readonly CashSessionView[];
}

export async function getCashSessions(orgId: string, limit = 20): Promise<CashSessionsOverview> {
  const rows = await db().select().from(cashSessions).where(eq(cashSessions.orgId, orgId)).orderBy(desc(cashSessions.openedAt)).limit(limit + 1);
  const counts = await paymentCounts(orgId, rows.map((r) => r.id));
  const names = await namesFor(orgId, rows.flatMap((r) => [r.openedBy, ...(r.closedBy ? [r.closedBy] : [])]));
  const views = rows.map((r) => view(r, counts.get(r.id) ?? 0, names));
  return { open: views.find((v) => v.status === "OPEN") ?? null, recent: views.filter((v) => v.status === "CLOSED").slice(0, limit) };
}

/* ------------------------------------------------------------------ */
/* Open                                                                */
/* ------------------------------------------------------------------ */

export type CashWriteFailure = { readonly ok: false; readonly code: "NO_LOCATION" | "ALREADY_OPEN" | "NOT_FOUND" | "ALREADY_CLOSED" | "NO_OPEN_SESSION" | "NOTHING_TO_HAND_OVER" | "INVALID"; readonly error: string };

export type OpenSessionResult = { readonly ok: true; readonly sessionId: string } | CashWriteFailure;

export async function openCashSession(input: { readonly orgId: string; readonly actorUserId: string; readonly openingFloat: Paise; readonly note: string | null }): Promise<OpenSessionResult> {
  const locationId = await getStoreLocationId(input.orgId);
  if (!locationId) return { ok: false, code: "NO_LOCATION", error: "This shop has no location set up yet." };

  try {
    return await db().transaction(async (tx) => {
      const [row] = await tx
        .insert(cashSessions)
        .values({ orgId: input.orgId, locationId, openedBy: input.actorUserId, openingFloat: input.openingFloat, note: input.note })
        .returning({ id: cashSessions.id });
      if (!row) throw new Error("cash: session insert returned no row");
      await tx.insert(auditLogs).values({
        orgId: input.orgId,
        locationId,
        actorUserId: input.actorUserId,
        action: "cash_session_opened",
        entity: "cash_sessions",
        entityId: row.id,
        before: null,
        after: { openingFloat: input.openingFloat.toString() },
      });
      return { ok: true, sessionId: row.id } as const;
    });
  } catch (error) {
    const code = (error as { code?: string; cause?: { code?: string } }).cause?.code ?? (error as { code?: string }).code;
    // The unique index: a till is already open. Say so; never open a second one.
    if (code === "23505") return { ok: false, code: "ALREADY_OPEN", error: "A till is already open. Close it before opening another." };
    throw error;
  }
}

/* ------------------------------------------------------------------ */
/* Close                                                               */
/* ------------------------------------------------------------------ */

/** Cash taken in a session and cash refunded out of it, summed from rows inside `tx`. */
async function sessionCashFigures(tx: Executor, orgId: string, session: { id: string }): Promise<{ readonly taken: Paise; readonly refunded: Paise }> {
  const [taken] = await tx
    .select({ total: sql<string>`coalesce(sum(${payments.amount}), 0)::text` })
    .from(payments)
    .where(and(eq(payments.orgId, orgId), eq(payments.cashSessionId, session.id), eq(payments.method, "CASH"), inArray(payments.status, [...CASH_TAKEN_STATUSES])));
  const [refunded] = await tx
    .select({ total: sql<string>`coalesce(sum(${refunds.amount}), 0)::text` })
    .from(refunds)
    .where(and(eq(refunds.orgId, orgId), eq(refunds.provider, "cash"), eq(refunds.status, "SUCCEEDED"), eq(refunds.cashSessionId, session.id)));
  return { taken: paise(BigInt(taken?.total ?? "0")), refunded: paise(BigInt(refunded?.total ?? "0")) };
}

export type CloseSessionResult =
  | { readonly ok: true; readonly counted: Paise; readonly expected: Paise; readonly variance: Paise }
  | CashWriteFailure;

export async function closeCashSession(input: { readonly orgId: string; readonly actorUserId: string; readonly sessionId: string; readonly counted: Paise; readonly note: string | null }): Promise<CloseSessionResult> {
  return db().transaction(async (tx) => {
    // FOR UPDATE: waits for any cash payment that is mid-settlement (it holds the row FOR SHARE), then counts.
    const [session] = await tx
      .select()
      .from(cashSessions)
      .where(and(eq(cashSessions.id, input.sessionId), eq(cashSessions.orgId, input.orgId)))
      .for("update")
      .limit(1);
    if (!session) return { ok: false, code: "NOT_FOUND", error: "That till could not be found." } as const;
    if (session.status === "CLOSED") return { ok: false, code: "ALREADY_CLOSED", error: "That till is already closed." } as const;

    // The database clock, read after the lock, is only the time the till closed. Cash and refunds are counted by the
    // till they are attributed to (payments.cash_session_id, refunds.cash_session_id): no timestamps are compared.
    const clock = await tx.execute(sql`select clock_timestamp() as now`);
    const now = new Date((clock as unknown as { now: string | Date }[])[0]!.now);
    const { taken, refunded } = await sessionCashFigures(tx, input.orgId, { id: session.id });
    const expected = expectedCash({ openingFloat: paise(session.openingFloat), cashTaken: taken, cashRefunded: refunded });
    const variance = varianceOf(input.counted, expected);

    await tx
      .update(cashSessions)
      .set({ status: "CLOSED", closedBy: input.actorUserId, closedAt: now, countedCash: input.counted, expectedCash: expected, variance, note: input.note ?? session.note })
      .where(and(eq(cashSessions.id, session.id), eq(cashSessions.orgId, input.orgId), eq(cashSessions.status, "OPEN")));

    await tx.insert(auditLogs).values({
      orgId: input.orgId,
      locationId: session.locationId,
      actorUserId: input.actorUserId,
      action: "cash_session_closed",
      entity: "cash_sessions",
      entityId: session.id,
      before: { openingFloat: paise(session.openingFloat).toString() },
      after: { counted: input.counted.toString(), expected: expected.toString(), variance: variance.toString(), cashTaken: taken.toString(), cashRefunded: refunded.toString() },
    });
    return { ok: true, counted: input.counted, expected, variance } as const;
  });
}

/* ------------------------------------------------------------------ */
/* Rider cash                                                          */
/* ------------------------------------------------------------------ */

export interface RiderCashRow {
  readonly riderUserId: string;
  readonly riderName: string | null;
  readonly paymentCount: number;
  readonly amount: Paise;
  readonly oldest: Date;
}

/** Door cash riders are carrying and have not handed over, per rider. */
export async function getRiderCashOutstanding(orgId: string): Promise<readonly RiderCashRow[]> {
  const rows = await db()
    .select({
      riderUserId: payments.collectedBy,
      n: sql<number>`count(*)::int`,
      total: sql<string>`coalesce(sum(${payments.amount}), 0)::text`,
      oldest: sql<Date>`min(${payments.capturedAt})`,
    })
    .from(payments)
    .where(and(eq(payments.orgId, orgId), eq(payments.method, "CASH"), eq(payments.heldByRider, true), isNull(payments.handoverId), inArray(payments.status, [...CASH_TAKEN_STATUSES])))
    .groupBy(payments.collectedBy)
    .orderBy(asc(sql`min(${payments.capturedAt})`));
  const names = await namesFor(orgId, rows.flatMap((r) => (r.riderUserId ? [r.riderUserId] : [])));
  return rows
    .filter((r): r is typeof r & { riderUserId: string } => r.riderUserId !== null)
    .map((r) => ({ riderUserId: r.riderUserId, riderName: names.get(r.riderUserId) ?? null, paymentCount: r.n, amount: paise(BigInt(r.total)), oldest: new Date(r.oldest) }));
}

export type HandoverResult =
  | { readonly ok: true; readonly handoverId: string; readonly expected: Paise; readonly declared: Paise; readonly variance: Paise; readonly paymentCount: number }
  | CashWriteFailure;

/**
 * A rider hands over the door cash they are carrying into the open till.
 * `declared` is what the rider put in the drawer; `expected` is what their door
 * payments add up to. Both are stored, and the difference is recorded against
 * the rider. The payments themselves join the session at their own amounts.
 */
export async function recordCashHandover(input: { readonly orgId: string; readonly actorUserId: string; readonly riderUserId: string; readonly declared: Paise; readonly note: string | null }): Promise<HandoverResult> {
  const locationId = await getStoreLocationId(input.orgId);
  if (!locationId) return { ok: false, code: "NO_LOCATION", error: "This shop has no location set up yet." };

  return db().transaction(async (tx) => {
    // The open till is held FOR SHARE for the whole handover, so it cannot close underneath it.
    const sessionId = await openSessionIdForPayment(tx, input.orgId, locationId);
    if (!sessionId) return { ok: false, code: "NO_OPEN_SESSION", error: "Open the till first: a rider's cash goes into the open till." } as const;

    if (input.actorUserId === input.riderUserId) return { ok: false, code: "INVALID", error: "A rider cannot receive their own cash. Someone else must take it." } as const;

    const held = await tx
      .select({ id: payments.id, amount: payments.amount })
      .from(payments)
      .where(
        and(
          eq(payments.orgId, input.orgId),
          eq(payments.method, "CASH"),
          eq(payments.heldByRider, true),
          isNull(payments.handoverId),
          eq(payments.collectedBy, input.riderUserId),
          inArray(payments.status, [...CASH_TAKEN_STATUSES]),
        ),
      )
      .for("update");
    if (held.length === 0) return { ok: false, code: "NOTHING_TO_HAND_OVER", error: "That rider has no door cash waiting to be handed over." } as const;

    const expected = held.reduce((sum, row) => add(sum, paise(row.amount)), ZERO);
    const variance = varianceOf(input.declared, expected);
    const [handover] = await tx
      .insert(cashHandovers)
      .values({ orgId: input.orgId, sessionId, riderUserId: input.riderUserId, receivedBy: input.actorUserId, expectedAmount: expected, declaredAmount: input.declared, variance, paymentCount: held.length, note: input.note })
      .returning({ id: cashHandovers.id });
    if (!handover) throw new Error("cash: handover insert returned no row");

    await tx
      .update(payments)
      .set({ handoverId: handover.id, cashSessionId: sessionId })
      .where(and(eq(payments.orgId, input.orgId), inArray(payments.id, held.map((row) => row.id)), isNull(payments.handoverId)));

    await tx.insert(auditLogs).values({
      orgId: input.orgId,
      locationId,
      actorUserId: input.actorUserId,
      action: "cash_handover_recorded",
      entity: "cash_handovers",
      entityId: handover.id,
      before: null,
      after: { riderUserId: input.riderUserId, sessionId, expected: expected.toString(), declared: input.declared.toString(), variance: variance.toString(), payments: held.length },
    });
    return { ok: true, handoverId: handover.id, expected, declared: input.declared, variance, paymentCount: held.length } as const;
  });
}

/* ------------------------------------------------------------------ */
/* Reconciliation (5.3)                                                */
/* ------------------------------------------------------------------ */

export interface ReconciliationDay {
  readonly date: string;
  /** Counter cash attached to a till session that day. */
  readonly cashInTill: Paise;
  /** Cash taken with no till open and not held by a rider: nobody's count covers it. */
  readonly cashUnassigned: Paise;
  /** Door cash taken that day that a rider still carries. */
  readonly cashWithRiders: Paise;
  readonly cashRefunded: Paise;
  /** Provider (online) money captured that day. */
  readonly onlineCaptured: Paise;
  readonly onlineRefunded: Paise;
  /** Everything captured minus everything refunded. */
  readonly net: Paise;
  /** Tills closed that day: how many, and the sum of their counted, expected and variance. */
  readonly sessionsClosed: number;
  readonly counted: Paise;
  readonly expected: Paise;
  readonly variance: Paise;
}

export interface Reconciliation {
  readonly days: readonly ReconciliationDay[];
  readonly openSession: boolean;
  /** Razorpay settlements are matched only once Razorpay is live and its settlement report is read. */
  readonly settlementsConnected: false;
}

export async function getReconciliation(orgId: string, range: { readonly from: string; readonly to: string }): Promise<Reconciliation> {
  const day = (column: unknown) => sql<string>`(${column} AT TIME ZONE 'Asia/Kolkata')::date::text`;
  const paymentRows = await db()
    .select({
      date: day(payments.capturedAt),
      cashInTill: sql<string>`coalesce(sum(${payments.amount}) filter (where ${payments.method} = 'CASH' and ${payments.cashSessionId} is not null), 0)::text`,
      cashUnassigned: sql<string>`coalesce(sum(${payments.amount}) filter (where ${payments.method} = 'CASH' and ${payments.cashSessionId} is null and not ${payments.heldByRider}), 0)::text`,
      cashWithRiders: sql<string>`coalesce(sum(${payments.amount}) filter (where ${payments.method} = 'CASH' and ${payments.heldByRider} and ${payments.handoverId} is null), 0)::text`,
      onlineCaptured: sql<string>`coalesce(sum(${payments.amount}) filter (where ${payments.method} <> 'CASH'), 0)::text`,
    })
    .from(payments)
    .where(and(eq(payments.orgId, orgId), inArray(payments.status, [...CASH_TAKEN_STATUSES]), sql`${payments.capturedAt} is not null`, sql`(${payments.capturedAt} AT TIME ZONE 'Asia/Kolkata')::date BETWEEN ${range.from} AND ${range.to}`))
    .groupBy(day(payments.capturedAt));

  const refundRows = await db()
    .select({
      date: day(refunds.finalizedAt),
      cashRefunded: sql<string>`coalesce(sum(${refunds.amount}) filter (where ${refunds.provider} = 'cash'), 0)::text`,
      onlineRefunded: sql<string>`coalesce(sum(${refunds.amount}) filter (where ${refunds.provider} <> 'cash'), 0)::text`,
    })
    .from(refunds)
    .where(and(eq(refunds.orgId, orgId), eq(refunds.status, "SUCCEEDED"), sql`${refunds.finalizedAt} is not null`, sql`(${refunds.finalizedAt} AT TIME ZONE 'Asia/Kolkata')::date BETWEEN ${range.from} AND ${range.to}`))
    .groupBy(day(refunds.finalizedAt));

  const sessionRows = await db()
    .select({
      date: day(cashSessions.closedAt),
      n: sql<number>`count(*)::int`,
      counted: sql<string>`coalesce(sum(${cashSessions.countedCash}), 0)::text`,
      expected: sql<string>`coalesce(sum(${cashSessions.expectedCash}), 0)::text`,
      variance: sql<string>`coalesce(sum(${cashSessions.variance}), 0)::text`,
    })
    .from(cashSessions)
    .where(and(eq(cashSessions.orgId, orgId), eq(cashSessions.status, "CLOSED"), sql`(${cashSessions.closedAt} AT TIME ZONE 'Asia/Kolkata')::date BETWEEN ${range.from} AND ${range.to}`))
    .groupBy(day(cashSessions.closedAt));

  const [open] = await db().select({ id: cashSessions.id }).from(cashSessions).where(and(eq(cashSessions.orgId, orgId), eq(cashSessions.status, "OPEN"))).limit(1);

  const dates = [...new Set([...paymentRows.map((r) => r.date), ...refundRows.map((r) => r.date), ...sessionRows.map((r) => r.date)])].sort().reverse();
  const p = (row: { [k: string]: unknown } | undefined, key: string): Paise => paise(BigInt((row?.[key] as string | undefined) ?? "0"));
  const days = dates.map((date): ReconciliationDay => {
    const pay = paymentRows.find((r) => r.date === date);
    const ref = refundRows.find((r) => r.date === date);
    const ses = sessionRows.find((r) => r.date === date);
    const captured = add(p(pay, "cashInTill"), p(pay, "cashUnassigned"), p(pay, "cashWithRiders"), p(pay, "onlineCaptured"));
    const refunded = add(p(ref, "cashRefunded"), p(ref, "onlineRefunded"));
    return {
      date,
      cashInTill: p(pay, "cashInTill"),
      cashUnassigned: p(pay, "cashUnassigned"),
      cashWithRiders: p(pay, "cashWithRiders"),
      cashRefunded: p(ref, "cashRefunded"),
      onlineCaptured: p(pay, "onlineCaptured"),
      onlineRefunded: p(ref, "onlineRefunded"),
      net: subtract(captured, refunded),
      sessionsClosed: ses?.n ?? 0,
      counted: p(ses, "counted"),
      expected: p(ses, "expected"),
      variance: p(ses, "variance"),
    };
  });
  return { days, openSession: open !== undefined, settlementsConnected: false };
}

/** Business dates for a quick default range (last 7 days, ending today). */
export function defaultReconciliationRange(now: Date = new Date()): { readonly from: string; readonly to: string } {
  const to = businessDate(now);
  return { from: businessDate(new Date(now.getTime() - 6 * 86_400_000)), to };
}
