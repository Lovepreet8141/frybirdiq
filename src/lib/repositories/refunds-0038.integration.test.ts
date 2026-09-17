/**
 * 0038_refunds_status_idempotency against the real local database: the
 * reservation columns the refund redesign (slice 1) builds on.
 *
 * - status has no default, and only RESERVED | SUCCEEDED | FAILED.
 * - finalized_at is set exactly when a refund is SUCCEEDED (FINANCE-LEDGER
 *   S6): RESERVED and FAILED keep it null.
 * - UNIQUE (org_id, idempotency_key): a key is used once per org; rows without
 *   a key (everything before 0038) never collide; another org may reuse a key.
 */
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/db";
import { orders, payments, refunds } from "@/db/schema";
import { fromRupees } from "@/lib/money";
import { createTestOrg, deleteTestOrg, type TestOrg } from "./__test-support__/fixtures";

async function sqlState(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
  } catch (error) {
    const e = error as { code?: string; cause?: { code?: string } };
    return e.cause?.code ?? e.code;
  }
  return undefined;
}

type Paid = { readonly org: TestOrg; readonly orderId: string; readonly paymentId: string };

async function paidOrder(org: TestOrg): Promise<Paid> {
  const [order] = await db()
    .insert(orders)
    .values({
      orgId: org.orgId,
      locationId: org.locationId,
      orderNumber: `TEST-${randomUUID().slice(0, 8)}`,
      businessDate: new Date().toISOString().slice(0, 10),
      status: "PAID",
      channel: "DINE_IN",
      fulfilment: "DINE_IN",
      grandTotal: fromRupees("300"),
    })
    .returning({ id: orders.id });
  const [payment] = await db()
    .insert(payments)
    .values({ orgId: org.orgId, orderId: order!.id, method: "CASH", amount: fromRupees("300"), provider: "cash", status: "CAPTURED" })
    .returning({ id: payments.id });
  return { org, orderId: order!.id, paymentId: payment!.id };
}

function refund(paid: Paid, overrides: Partial<typeof refunds.$inferInsert> = {}): typeof refunds.$inferInsert {
  return {
    orgId: paid.org.orgId,
    paymentId: paid.paymentId,
    orderId: paid.orderId,
    amount: fromRupees("10"),
    reason: "test",
    provider: "cash",
    status: "RESERVED",
    ...overrides,
  };
}

/** payments.order_id and refunds.* are ON DELETE RESTRICT: clear them before the org cascade. */
async function cleanup(org: TestOrg | undefined) {
  if (!org) return;
  await db().delete(refunds).where(eq(refunds.orgId, org.orgId));
  await db().delete(payments).where(eq(payments.orgId, org.orgId));
  await deleteTestOrg(org.orgId);
}

describe("0038 — refunds status, finalized_at and idempotency key", () => {
  let paid: Paid;
  let other: Paid;

  beforeAll(async () => {
    paid = await paidOrder(await createTestOrg());
    other = await paidOrder(await createTestOrg());
  });

  afterAll(async () => {
    await cleanup(paid?.org);
    await cleanup(other?.org);
  });

  it("status has no default and accepts only RESERVED, SUCCEEDED, FAILED", async () => {
    const [column] = await db().execute<{ column_default: string | null; is_nullable: string }>(sql`
      SELECT column_default, is_nullable FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'refunds' AND column_name = 'status'
    `);
    expect(column).toEqual({ column_default: null, is_nullable: "NO" });

    const noStatus = db().execute(sql`
      INSERT INTO refunds (org_id, payment_id, order_id, amount, reason, provider)
      VALUES (${paid.org.orgId}, ${paid.paymentId}, ${paid.orderId}, 1000, 'test', 'cash')
    `);
    expect(await sqlState(noStatus)).toBe("23502");
    expect(await sqlState(db().insert(refunds).values(refund(paid, { status: "PENDING" as never })))).toBe("23514");
  });

  it("finalized_at is set exactly when the refund is SUCCEEDED", async () => {
    await db().insert(refunds).values(refund(paid, { status: "RESERVED" }));
    await db().insert(refunds).values(refund(paid, { status: "FAILED" }));
    await db().insert(refunds).values(refund(paid, { status: "SUCCEEDED", finalizedAt: new Date() }));

    expect(await sqlState(db().insert(refunds).values(refund(paid, { status: "SUCCEEDED" })))).toBe("23514");
    expect(await sqlState(db().insert(refunds).values(refund(paid, { status: "RESERVED", finalizedAt: new Date() })))).toBe("23514");
    expect(await sqlState(db().insert(refunds).values(refund(paid, { status: "FAILED", finalizedAt: new Date() })))).toBe("23514");

    // RESERVED → SUCCEEDED must set finalized_at in the same update.
    const [row] = await db().insert(refunds).values(refund(paid)).returning({ id: refunds.id });
    expect(await sqlState(db().update(refunds).set({ status: "SUCCEEDED" }).where(eq(refunds.id, row!.id)))).toBe("23514");
    await db().update(refunds).set({ status: "SUCCEEDED", finalizedAt: new Date() }).where(eq(refunds.id, row!.id));
  });

  it("an idempotency key is used once per org; null keys never collide; another org may reuse a key", async () => {
    const key = `refund-${randomUUID()}`;
    await db().insert(refunds).values(refund(paid, { idempotencyKey: key }));
    expect(await sqlState(db().insert(refunds).values(refund(paid, { idempotencyKey: key })))).toBe("23505");
    await db().insert(refunds).values(refund(other, { idempotencyKey: key }));

    await db().insert(refunds).values(refund(paid, { idempotencyKey: null }));
    await db().insert(refunds).values(refund(paid, { idempotencyKey: null }));

    expect(await sqlState(db().insert(refunds).values(refund(paid, { idempotencyKey: "" })))).toBe("23514");
    expect(await sqlState(db().insert(refunds).values(refund(paid, { idempotencyKey: "k".repeat(201) })))).toBe("23514");
  });

  it("has the payment and stuck-reservation indexes", async () => {
    const rows = await db().execute<{ indexname: string; indexdef: string }>(sql`
      SELECT indexname, indexdef FROM pg_indexes
      WHERE schemaname = 'public' AND tablename = 'refunds'
        AND indexname IN ('refunds_payment_idx', 'refunds_reserved_idx', 'refunds_org_idempotency_unique')
      ORDER BY indexname
    `);
    expect(rows.map((r) => r.indexname)).toEqual(["refunds_org_idempotency_unique", "refunds_payment_idx", "refunds_reserved_idx"]);
    expect(rows.find((r) => r.indexname === "refunds_reserved_idx")?.indexdef).toMatch(/WHERE \(status = 'RESERVED'::text\)/);
  });
});
