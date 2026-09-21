/**
 * `till-close-micros`: the ROOT CAUSE, reproduced deterministically through the real `closeCashSession`.
 *
 * The old close asked the database for `clock_timestamp()` (microseconds), turned it into a JavaScript Date (milliseconds:
 * everything after the third decimal is dropped) and counted the cash refunds with `finalized_at <= that Date`. A refund
 * finalized in the SAME millisecond as the close but later inside it (…123456 against a clock of …123900, truncated to …123)
 * was excluded from the till's expected cash, so the till counted short by the refund: QA saw exactly that, once, as
 * "expected 137000n, received 140000n". This test injects that exact reading. It FAILS on the old code (the refund is
 * missing from `expected`) and passes now, because a till counts the refunds attributed to it and compares no timestamps.
 */
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { cashSessions, orders, payments, refunds } from "@/db/schema";
import { fromRupees, paise } from "@/lib/money";
import { createTestOrg, deleteTestOrg, type TestOrg } from "./__test-support__/fixtures";
import { closeCashSession, openCashSession } from "./cash-sessions";
import { recordCashPayment } from "./payments";

let org: TestOrg;
const cashier = randomUUID();

beforeAll(async () => {
  org = await createTestOrg();
});
afterAll(async () => {
  await deleteTestOrg(org.orgId);
});
afterEach(() => vi.restoreAllMocks());

/** Makes the close's `select clock_timestamp()` return this exact instant (everything else runs against the real database). */
function injectClock(iso: string) {
  const real = db();
  const original = real.transaction.bind(real);
  vi.spyOn(real, "transaction").mockImplementation(((callback: (tx: never) => Promise<unknown>, config?: never) =>
    original(async (tx) => {
      const execute = tx.execute.bind(tx);
      (tx as { execute: unknown }).execute = async (query: { queryChunks?: { value?: unknown }[] }) => {
        const text = (query.queryChunks ?? []).map((chunk) => String((chunk as { value?: unknown }).value ?? "")).join("");
        if (text.includes("clock_timestamp()")) return [{ now: iso }];
        return execute(query as never);
      };
      return callback(tx as never);
    }, config)) as never);
}

describe("the till-close-micros root cause", () => {
  it("premise: a JavaScript Date keeps milliseconds only, so a clock reading of ...123900 becomes ...123 and a refund at ...123456 falls after it", () => {
    expect(new Date("2026-09-21T13:00:00.123900Z").toISOString()).toBe("2026-09-21T13:00:00.123Z");
    expect(new Date("2026-09-21T13:00:00.123900Z").getTime()).toBe(new Date("2026-09-21T13:00:00.123Z").getTime());
  });

  it("a cash refund finalized in the same millisecond as the close, later within it, is in the till's expected cash (it was dropped before)", async () => {
    const opened = await openCashSession({ idempotencyKey: crypto.randomUUID(), orgId: org.orgId, actorUserId: cashier, openingFloat: fromRupees("1000"), note: null });
    if (!opened.ok) throw new Error(opened.error);
    const [order] = await db()
      .insert(orders)
      .values({ orgId: org.orgId, locationId: org.locationId, orderNumber: `M-${randomUUID().slice(0, 8)}`, businessDate: new Date().toISOString().slice(0, 10), status: "PENDING_PAYMENT", channel: "TAKEAWAY", fulfilment: "TAKEAWAY", grandTotal: fromRupees("500") })
      .returning({ id: orders.id });
    const paid = await recordCashPayment({ orderId: order!.id, actorUserId: cashier, actorRoles: ["OWNER"], orgId: org.orgId });
    if (!paid.ok) throw new Error(paid.error);
    const [payment] = await db().select().from(payments).where(eq(payments.orderId, order!.id));

    // One hour after now, so it is after the till opened and the payment: the clock reads ...123900, the refund was stamped ...123456.
    const second = new Date(Date.now() + 3_600_000).toISOString().slice(0, 19);
    await db()
      .insert(refunds)
      .values({
        orgId: org.orgId,
        paymentId: payment!.id,
        orderId: order!.id,
        amount: fromRupees("120"),
        reason: "wrong item",
        provider: "cash",
        status: "SUCCEEDED",
        finalizedAt: sql`${second + ".123456+00"}::timestamptz`,
        cashSessionId: opened.sessionId,
      });

    injectClock(`${second}.123900Z`);
    const closed = await closeCashSession({ idempotencyKey: crypto.randomUUID(), orgId: org.orgId, actorUserId: cashier, sessionId: opened.sessionId, counted: fromRupees("1380"), note: null });
    // 1000 float + 500 taken - 120 refunded. The old code returned expected 1500 (the refund missing) and a false "over" of 120.
    expect(closed).toMatchObject({ ok: true, expected: fromRupees("1380"), variance: paise(0) });
    const [row] = await db().select().from(cashSessions).where(eq(cashSessions.id, opened.sessionId));
    expect(row).toMatchObject({ expectedCash: fromRupees("1380"), variance: paise(0) });
  });
});
