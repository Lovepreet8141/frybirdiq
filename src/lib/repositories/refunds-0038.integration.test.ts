/**
 * 0038_refunds_status_idempotency against the real local database: the
 * reservation columns the refund redesign (slice 1) builds on.
 *
 * - status is only RESERVED | SUCCEEDED | FAILED. Expand phase (RELIABILITY):
 *   status defaults to SUCCEEDED and finalized_at to now(), so the code that
 *   is live when the migration runs keeps inserting refunds.
 * - finalized_at is set exactly when a refund is SUCCEEDED (FINANCE-LEDGER
 *   S6): RESERVED and FAILED keep it null — and must say so explicitly.
 * - The down file, run inside a transaction that is rolled back: it refuses
 *   while any refund is not SUCCEEDED, sets a 5 s lock timeout, and otherwise
 *   removes exactly what 0038 added.
 * - UNIQUE (org_id, idempotency_key): a key is used once per org; rows without
 *   a key (everything before 0038) never collide; another org may reuse a key.
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
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
    finalizedAt: null,
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

  it("expand phase: an insert with neither status nor finalized_at, as the live code does, is a finalized SUCCEEDED refund", async () => {
    const defaults = await db().execute<{ column_name: string; column_default: string | null }>(sql`
      SELECT column_name, column_default FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'refunds' AND column_name IN ('status', 'finalized_at')
      ORDER BY column_name
    `);
    expect(defaults).toEqual([
      { column_name: "finalized_at", column_default: "now()" },
      { column_name: "status", column_default: "'SUCCEEDED'::text" },
    ]);

    const [legacy] = await db().execute<{ status: string; finalized: boolean }>(sql`
      INSERT INTO refunds (org_id, payment_id, order_id, amount, reason, provider)
      VALUES (${paid.org.orgId}, ${paid.paymentId}, ${paid.orderId}, 1000, 'legacy insert', 'cash')
      RETURNING status, finalized_at IS NOT NULL AS finalized
    `);
    expect(legacy).toEqual({ status: "SUCCEEDED", finalized: true });
    expect(await sqlState(db().insert(refunds).values(refund(paid, { status: "PENDING" as never, finalizedAt: null })))).toBe("23514");
  });

  it("finalized_at is set exactly when the refund is SUCCEEDED; RESERVED and FAILED must pass null", async () => {
    await db().insert(refunds).values(refund(paid, { status: "RESERVED", finalizedAt: null }));
    await db().insert(refunds).values(refund(paid, { status: "FAILED", finalizedAt: null }));
    await db().insert(refunds).values(refund(paid, { status: "SUCCEEDED", finalizedAt: new Date() }));
    const { finalizedAt: _omitted, ...withoutFinalizedAt } = refund(paid, { status: "SUCCEEDED" });
    void _omitted;
    await db().insert(refunds).values(withoutFinalizedAt);

    // Omitting finalized_at on a RESERVED insert takes the now() default and is refused.
    const { finalizedAt: _omittedToo, ...reservedWithoutFinalizedAt } = refund(paid, { status: "RESERVED" });
    void _omittedToo;
    expect(await sqlState(db().insert(refunds).values(reservedWithoutFinalizedAt))).toBe("23514");
    expect(await sqlState(db().insert(refunds).values(refund(paid, { status: "SUCCEEDED", finalizedAt: null })))).toBe("23514");
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

/** The down file's body without its own BEGIN/COMMIT, to run inside a transaction the test rolls back. */
function downBody(): string {
  const file = readFileSync(join(__dirname, "../../../supabase/rollback/0038_refunds_status_idempotency.down.sql"), "utf8");
  const begin = file.indexOf("\nBEGIN;\n");
  const commit = file.lastIndexOf("\nCOMMIT;");
  if (begin < 0 || commit < begin) throw new Error("refunds-0038: down file has no BEGIN/COMMIT block");
  return file.slice(begin + "\nBEGIN;\n".length, commit);
}

class RollBack extends Error {}

describe("0038 — the down file (run inside a rolled-back transaction)", () => {
  let paid: Paid;

  beforeAll(async () => {
    paid = await paidOrder(await createTestOrg());
    // The guard reads the whole table: no RESERVED/FAILED row from another file may linger.
    await db().delete(refunds).where(sql`${refunds.status} <> 'SUCCEEDED'`);
  });

  afterAll(async () => {
    await cleanup(paid?.org);
  });

  const columns = async (tx: Pick<ReturnType<typeof db>, "execute"> = db()) =>
    (
      await tx.execute<{ column_name: string }>(sql`
        SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'refunds' AND column_name IN ('status', 'idempotency_key', 'finalized_at')
        ORDER BY column_name
      `)
    ).map((r) => r.column_name);

  it("refuses while a refund is RESERVED, naming it, and changes nothing", async () => {
    const [reserved] = await db().insert(refunds).values(refund(paid)).returning({ id: refunds.id });
    let message = "";
    const state = await sqlState(
      db()
        .transaction(async (tx) => {
          await tx.execute(sql.raw(downBody()));
        })
        .catch((error: { cause?: { message?: string } }) => {
          message = error.cause?.message ?? "";
          throw error;
        }),
    );
    expect(state).toBe("55000");
    expect(message).toContain(reserved!.id);
    expect(await columns()).toEqual(["finalized_at", "idempotency_key", "status"]);
    await db().update(refunds).set({ status: "SUCCEEDED", finalizedAt: new Date() }).where(eq(refunds.id, reserved!.id));
  });

  it("with every refund SUCCEEDED, sets a 5 s lock timeout and removes exactly 0038's columns, indexes and constraints", async () => {
    await expect(
      db().transaction(async (tx) => {
        await tx.execute(sql.raw(downBody()));
        const [timeout] = await tx.execute<{ lock_timeout: string }>(sql`SHOW lock_timeout`);
        expect(timeout?.lock_timeout).toBe("5s");
        expect(await columns(tx)).toEqual([]);
        const [leftovers] = await tx.execute<{ n: number }>(sql`
          SELECT (SELECT count(*) FROM pg_indexes WHERE tablename = 'refunds'
                    AND indexname IN ('refunds_payment_idx', 'refunds_reserved_idx', 'refunds_org_idempotency_unique'))
               + (SELECT count(*) FROM pg_constraint WHERE conrelid = 'public.refunds'::regclass
                    AND conname IN ('refunds_status_check', 'refunds_finalized_check', 'refunds_idempotency_key_check'))
               AS n
        `);
        expect(Number(leftovers?.n)).toBe(0);
        const [kept] = await tx.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM refunds WHERE org_id = ${paid.org.orgId}`);
        expect(kept?.n).toBe(1);
        throw new RollBack();
      }),
    ).rejects.toBeInstanceOf(RollBack);
    expect(await columns()).toEqual(["finalized_at", "idempotency_key", "status"]);
  });
});
