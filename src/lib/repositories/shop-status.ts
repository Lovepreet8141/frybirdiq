import "server-only";

/**
 * The Close Shop switch (ops-1 S3): read it, set it, lift it.
 *
 * Staff pause online ordering without touching the trading hours — a power
 * cut, the fryer down. Two modes (owner requirement 1): UNTIL_NEXT_OPENING,
 * the default, which ends by itself at the next opening; and UNTIL_RESUMED,
 * which holds until someone switches ordering back on.
 *
 * ONE READ, ONE MAPPING. `placeOrder`, the POS control, the Admin control and
 * the website banner all turn the org row into a pause state through
 * `shopStatusFromOrg`, and decide through the same `orderingRefusal`. That is
 * a correctness requirement, not tidiness (RELIABILITY, ops-1 req 4): a
 * missing value reads as "not paused" on purpose, and that is only safe if
 * the screen a cashier presses Pause on reads the column the way the order
 * gate does — so a pause that did not take shows as not taken, at once,
 * instead of a banner saying "paused" while orders keep arriving.
 *
 * THE ONE RULE for "paused right now" is `isPaused` in opening-hours.ts. Its
 * SQL twin is `pausedNow` below; the 0039 down script carries a third copy.
 * All three must say the same thing — see `isPaused`'s comment.
 *
 * Every repository call scopes by org_id itself (CLAUDE.md).
 */

import { and, eq, notInArray, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { auditLogs, memberships, orders, organizations } from "@/db/schema";
import { TERMINAL_STATUSES } from "@/domain/order-status";
import { type PauseMode, type ShopStatus, pauseCarriedOver, pausedUntilFor } from "@/lib/orders/opening-hours";
import { type ShopOrderingState, dayAndClock, shopOrderingState } from "@/lib/cart/shop-hours";

type OrgRow = typeof organizations.$inferSelect;

/**
 * The org row as the ordering gate sees it. The ONLY place that maps it:
 * a field forgotten here is forgotten everywhere at once, and the tests that
 * go through `placeOrder` catch it.
 */
export function shopStatusFromOrg(org: Pick<OrgRow, "openingTime" | "closingTime" | "orderingPausedAt" | "orderingPausedUntil">): ShopStatus {
  return {
    openingTime: org.openingTime,
    closingTime: org.closingTime,
    orderingPausedAt: org.orderingPausedAt,
    orderingPausedUntil: org.orderingPausedUntil,
  };
}

/**
 * SQL twin of `isPaused`: paused_at set AND (paused_until null OR now < paused_until).
 * `now` is bound from the app's clock, not the database's `now()`, so this and
 * the TypeScript gate answer from the same instant — and a test can set it.
 */
function pausedNow(now: Date): SQL {
  return sql`(${organizations.orderingPausedAt} IS NOT NULL AND (${organizations.orderingPausedUntil} IS NULL OR ${organizations.orderingPausedUntil} > ${instant(now)}))`;
}

/**
 * A Date bound into hand-written SQL. Drizzle converts a Date for a typed
 * column (`.set({ at: now })`), but not inside a raw `sql` fragment, where the
 * driver is handed the Date object itself and refuses it (ERR_INVALID_ARG_TYPE).
 * An ISO string with an explicit cast is exact to the millisecond, which is all
 * a JS Date holds.
 */
function instant(at: Date): SQL {
  return sql`${at.toISOString()}::timestamptz`;
}

/* ------------------------------------------------------------------ reads */

/**
 * What a customer may see: open, closed by the hours, or paused — and when it
 * reopens. Nothing about who paused or why. For the website banner (S5).
 */
export async function getOrderingStatus(orgId: string, now: Date = new Date()): Promise<ShopOrderingState | null> {
  const org = await readOrg(orgId);
  return org ? shopOrderingState(now, shopStatusFromOrg(org)) : null;
}

/** What staff see on the POS and in Admin: the same state, plus who paused, why, and the orders still to be made. */
export type StaffOrderingStatus = ShopOrderingState & {
  /** Present only while paused. The display name from the staff table, or null when none is set. */
  readonly pausedBy: { readonly userId: string; readonly name: string | null } | null;
  /** Staff's own words when pausing. Present only while paused; never sent to a customer. */
  readonly reason: string | null;
  /**
   * Orders already placed that are not finished — accepted, cooking, ready,
   * out, and still waiting for payment (D4 (c)). Pausing never touches them; the
   * confirm says how many there are so nobody forgets those customers.
   */
  readonly ordersStillDue: number;
  /**
   * The pause began before today's opening and is still in force — the
   * forgot-to-reopen case. The POS turns its first screen of the day into a
   * keep-closed-or-open decision (ops-1 R1). Computed here, from the same row
   * as everything else, so the screen never works it out from columns itself.
   */
  readonly carriedOver: boolean;
};

export async function getOrderingStatusForStaff(orgId: string, now: Date = new Date()): Promise<StaffOrderingStatus | null> {
  const org = await readOrg(orgId);
  if (!org) return null;
  return staffStatus(orgId, org, now);
}

async function readOrg(orgId: string): Promise<OrgRow | null> {
  const [org] = await db().select().from(organizations).where(eq(organizations.id, orgId)).limit(1);
  return org ?? null;
}

async function staffStatus(orgId: string, org: OrgRow, now: Date): Promise<StaffOrderingStatus> {
  const state = shopOrderingState(now, shopStatusFromOrg(org));
  const paused = state.state === "paused";
  const [name, ordersStillDue] = await Promise.all([
    paused && org.orderingPausedBy ? displayName(orgId, org.orderingPausedBy) : Promise.resolve(null),
    countOrdersStillDue(orgId),
  ]);
  return {
    ...state,
    pausedBy: paused && org.orderingPausedBy ? { userId: org.orderingPausedBy, name } : null,
    reason: paused ? org.orderingPausedReason : null,
    ordersStillDue,
    carriedOver: pauseCarriedOver(shopStatusFromOrg(org), now),
  };
}

/** What a pause taken right now would mean — shown BEFORE anyone confirms it. */
export interface PausePreview {
  /** When "until we next open" would end, if chosen now. */
  readonly nextOpeningAt: Date;
  /** "today at 11:30 AM" — so a 9 am pause says plainly that the default ends at 11:30 today. */
  readonly nextOpeningLabel: string;
  /** Orders already placed and not finished — the customers who may need a call. */
  readonly ordersStillDue: number;
}

/**
 * The confirm dialog's facts, on the server's clock at the moment it opens.
 * Not from the page load: a POS left open at 10:55 and pressed at 11:40 would
 * otherwise promise "today at 11:30" for a pause that actually runs to
 * tomorrow. The pause itself still computes its end again when it is taken.
 */
export async function previewPause(orgId: string, now: Date = new Date()): Promise<PausePreview | null> {
  const org = await readOrg(orgId);
  if (!org) return null;
  const nextOpeningAt = pausedUntilFor("UNTIL_NEXT_OPENING", now, org.openingTime, org.closingTime);
  if (!nextOpeningAt) return null;
  return { nextOpeningAt, nextOpeningLabel: dayAndClock(nextOpeningAt, now), ordersStillDue: await countOrdersStillDue(orgId) };
}

async function displayName(orgId: string, userId: string): Promise<string | null> {
  // One membership row per role, so a person can have several; any set name will do.
  const rows = await db()
    .select({ displayName: memberships.displayName })
    .from(memberships)
    .where(and(eq(memberships.orgId, orgId), eq(memberships.userId, userId)));
  return rows.find((row) => row.displayName)?.displayName ?? null;
}

/** Placed, not finished, and not a draft. PENDING_PAYMENT counts: those customers are waiting too. */
export async function countOrdersStillDue(orgId: string): Promise<number> {
  const [row] = await db()
    .select({ count: sql<number>`count(*)::int` })
    .from(orders)
    .where(and(eq(orders.orgId, orgId), notInArray(orders.status, [...TERMINAL_STATUSES, "DRAFT"])));
  return row?.count ?? 0;
}

/* ----------------------------------------------------------------- writes */

export type PauseOrderingResult =
  /** `changed: false` — it was already paused; the pause that is in force is returned untouched. */
  | { readonly ok: true; readonly changed: boolean; readonly status: StaffOrderingStatus }
  | { readonly ok: false; readonly code: "SHOP_NOT_FOUND"; readonly error: string };

/**
 * Pauses online ordering.
 *
 * Compare-and-set, never read-then-write (DATABASE A3 / RELIABILITY req 2):
 * one UPDATE that only matches when the shop is not paused right now, and the
 * audit row only if it matched, in the same transaction. Two tills pressing
 * Pause together give one pause and one audit row, and the second press does
 * not reset `paused_at` — the clock the banner and "paused since" read.
 *
 * "Not paused right now" is the whole rule, not `paused_at IS NULL`: a timed
 * pause that has already reopened leaves `paused_at` in the row, and a check
 * on that column alone would refuse to pause a shop that is taking orders.
 *
 * `paused_at` is the app's own `now` — a JS Date, so milliseconds — which is
 * what makes `resumeOrdering`'s exact match work; `now()` in SQL would store
 * microseconds that the millisecond value read back can never equal.
 *
 * If the update matched nothing because a pause is in force, that pause is
 * the answer. If it matched nothing and the shop turns out NOT to be paused
 * (a resume, or the end of a timed pause, landed in between), it tries once
 * more, then reports whatever is true rather than claim a pause.
 */
export async function pauseOrdering(input: {
  readonly orgId: string;
  readonly actorUserId: string;
  readonly reason: string;
  readonly mode: PauseMode;
  readonly now?: Date;
}): Promise<PauseOrderingResult> {
  const now = input.now ?? new Date();

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const outcome = await db().transaction(async (tx) => {
      const [org] = await tx
        .select({ openingTime: organizations.openingTime, closingTime: organizations.closingTime })
        .from(organizations)
        .where(eq(organizations.id, input.orgId))
        .limit(1);
      if (!org) return "missing" as const;

      const pausedUntil = pausedUntilFor(input.mode, now, org.openingTime, org.closingTime);
      const [paused] = await tx
        .update(organizations)
        .set({
          orderingPausedAt: now,
          orderingPausedBy: input.actorUserId,
          orderingPausedReason: input.reason,
          orderingPausedUntil: pausedUntil,
          updatedAt: now,
        })
        .where(and(eq(organizations.id, input.orgId), sql`NOT ${pausedNow(now)}`))
        .returning({ id: organizations.id });
      if (!paused) return "notChanged" as const;

      await tx.insert(auditLogs).values({
        orgId: input.orgId,
        actorUserId: input.actorUserId,
        action: "ordering_paused",
        entity: "organizations",
        entityId: input.orgId,
        after: {
          mode: input.mode,
          pausedAt: now.toISOString(),
          reopensAt: pausedUntil?.toISOString() ?? null,
          reason: input.reason,
        },
      });
      return "changed" as const;
    });

    if (outcome === "missing") return { ok: false, code: "SHOP_NOT_FOUND", error: "That shop could not be found." };

    const org = await readOrg(input.orgId);
    if (!org) return { ok: false, code: "SHOP_NOT_FOUND", error: "That shop could not be found." };
    const status = await staffStatus(input.orgId, org, now);
    if (outcome === "changed") return { ok: true, changed: true, status };
    if (status.state === "paused") return { ok: true, changed: false, status };
    // Matched nothing, yet not paused: something moved in between. Once more.
    if (attempt === 1) return { ok: true, changed: false, status };
  }
  // Unreachable: the loop returns on its second pass.
  return { ok: false, code: "SHOP_NOT_FOUND", error: "That shop could not be found." };
}

export type ResumeOrderingResult =
  /** `changed: false` — it was already open (someone else resumed, or a timed pause ended by itself). */
  | { readonly ok: true; readonly changed: boolean; readonly status: StaffOrderingStatus }
  /** A different pause is in force than the one the screen showed; nothing was changed. */
  | { readonly ok: false; readonly code: "PAUSE_CHANGED"; readonly error: string; readonly status: StaffOrderingStatus }
  | { readonly ok: false; readonly code: "SHOP_NOT_FOUND"; readonly error: string };

/**
 * Switches ordering back on — but only the pause the person was looking at
 * (RELIABILITY req 3). A Resume pressed on a stale screen must not lift a
 * newer pause someone set a minute later for a different reason: the fire
 * after the power came back. So the update names the pause it ends by its
 * `paused_at`, and matches nothing if that pause is no longer the one in
 * force.
 *
 * Compared at millisecond precision on both sides: `pauseOrdering` writes
 * milliseconds, but a pause written some other way — a manual repair in SQL
 * with `now()` — would carry microseconds, and an exact match against the
 * millisecond value a screen read back would then never succeed, leaving no
 * way to reopen from the banner.
 *
 * Clears all four columns: DATABASE's CHECK refuses a reason or an end time
 * without a pause.
 */
export async function resumeOrdering(input: {
  readonly orgId: string;
  readonly actorUserId: string;
  /** The `pausedAt` the screen showed. */
  readonly shownPausedAt: Date;
  readonly now?: Date;
}): Promise<ResumeOrderingResult> {
  const now = input.now ?? new Date();

  const resumed = await db().transaction(async (tx) => {
    // What the audit row says about the pause being ended. Read under the row
    // lock so it describes exactly the pause the update below clears; the
    // update's own conditions still decide whether anything is cleared.
    const [ending] = await tx
      .select({ by: organizations.orderingPausedBy, reason: organizations.orderingPausedReason, until: organizations.orderingPausedUntil })
      .from(organizations)
      .where(eq(organizations.id, input.orgId))
      .for("update")
      .limit(1);

    const [row] = await tx
      .update(organizations)
      .set({ orderingPausedAt: null, orderingPausedBy: null, orderingPausedReason: null, orderingPausedUntil: null, updatedAt: now })
      .where(
        and(
          eq(organizations.id, input.orgId),
          pausedNow(now),
          sql`date_trunc('milliseconds', ${organizations.orderingPausedAt}) = date_trunc('milliseconds', ${instant(input.shownPausedAt)})`,
        ),
      )
      .returning({ id: organizations.id });
    if (!row) return false;

    await tx.insert(auditLogs).values({
      orgId: input.orgId,
      actorUserId: input.actorUserId,
      action: "ordering_resumed",
      entity: "organizations",
      entityId: input.orgId,
      before: {
        pausedAt: input.shownPausedAt.toISOString(),
        pausedBy: ending?.by ?? null,
        mode: ending?.until ? "UNTIL_NEXT_OPENING" : "UNTIL_RESUMED",
        reopensAt: ending?.until?.toISOString() ?? null,
        reason: ending?.reason ?? null,
      },
      after: { resumedAt: now.toISOString() },
    });
    return true;
  });

  const org = await readOrg(input.orgId);
  if (!org) return { ok: false, code: "SHOP_NOT_FOUND", error: "That shop could not be found." };
  const status = await staffStatus(input.orgId, org, now);
  if (resumed) return { ok: true, changed: true, status };
  if (status.state !== "paused") return { ok: true, changed: false, status };
  return {
    ok: false,
    code: "PAUSE_CHANGED",
    error: "Someone changed the pause since this screen loaded. Here is the pause in force now — check it before switching ordering back on.",
    status,
  };
}
