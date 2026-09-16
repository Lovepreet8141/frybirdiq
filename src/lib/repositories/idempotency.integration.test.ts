/**
 * withIdempotency against a real database — the literal implementation of
 * "every mutation that matters is idempotent" (CLAUDE.md), and, per the
 * V2 system audit, the single highest-risk piece of code in the entire
 * app with zero prior test coverage of any kind: every order, every
 * payment, and now (Priority 6) every stock receipt and adjustment
 * depends on this behaving correctly under real concurrency, which a
 * pure unit test — this function does nothing without Postgres — can't
 * exercise at all.
 */
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { idempotencyKeys } from "@/db/schema";
import { IdempotencyConflict, withIdempotency } from "./idempotency";

const OPERATION = "integration_test_op";

afterEach(async () => {
  // No org scoping on this table's own test rows to clean — delete by the
  // one operation name this file uses, never touching anything else's keys.
  await db().delete(idempotencyKeys).where(eq(idempotencyKeys.operation, OPERATION));
});

describe("withIdempotency", () => {
  it("runs the work exactly once for a fresh key", async () => {
    let runs = 0;
    const { result, replayed } = await withIdempotency({ key: randomUUID(), operation: OPERATION, request: { a: 1 } }, async () => {
      runs++;
      return { orderId: "abc" };
    });
    expect(runs).toBe(1);
    expect(replayed).toBe(false);
    expect(result).toEqual({ orderId: "abc" });
  });

  it("replays the stored result for a repeated key with identical content, without running the work again", async () => {
    const key = randomUUID();
    const request = { cart: "6pc-wings" };
    let runs = 0;
    const work = async () => {
      runs++;
      return { orderId: randomUUID() };
    };

    const first = await withIdempotency({ key, operation: OPERATION, request }, work);
    const second = await withIdempotency({ key, operation: OPERATION, request }, work);

    expect(runs).toBe(1);
    expect(first.replayed).toBe(false);
    expect(second.replayed).toBe(true);
    expect(second.result).toEqual(first.result);
  });

  it("the exact race this exists for: two truly concurrent calls with the same key run the work exactly once and both resolve to the same result", async () => {
    const key = randomUUID();
    const request = { cart: "concurrent" };
    let runs = 0;
    const work = async () => {
      runs++;
      await new Promise((resolve) => setTimeout(resolve, 100));
      return { orderId: randomUUID() };
    };

    const [a, b] = await Promise.all([
      withIdempotency({ key, operation: OPERATION, request }, work),
      withIdempotency({ key, operation: OPERATION, request }, work),
    ]);

    expect(runs).toBe(1);
    expect(a.result).toEqual(b.result);
    // Exactly one of the two claimed the row and ran the work; the other replayed it.
    expect([a.replayed, b.replayed].sort()).toEqual([false, true]);
  });

  it("refuses a key reused with different content, rather than silently returning someone else's result", async () => {
    const key = randomUUID();
    await withIdempotency({ key, operation: OPERATION, request: { cart: "6pc-wings" } }, async () => ({ orderId: "first" }));

    await expect(withIdempotency({ key, operation: OPERATION, request: { cart: "12pc-wings" } }, async () => ({ orderId: "second" }))).rejects.toThrow(IdempotencyConflict);
  });

  it("releases the claim when the work throws, so a genuine retry (same key, same content) can succeed", async () => {
    const key = randomUUID();
    const request = { attempt: "flaky" };
    let calls = 0;

    await expect(
      withIdempotency({ key, operation: OPERATION, request }, async () => {
        calls++;
        throw new Error("simulated transient failure");
      }),
    ).rejects.toThrow("simulated transient failure");

    // The claim row must be gone — not left behind as a permanent "already failed" marker.
    const [claim] = await db()
      .select({ id: idempotencyKeys.id })
      .from(idempotencyKeys)
      .where(and(eq(idempotencyKeys.key, key), eq(idempotencyKeys.operation, OPERATION)));
    expect(claim).toBeUndefined();

    const { result, replayed } = await withIdempotency({ key, operation: OPERATION, request }, async () => {
      calls++;
      return { ok: true };
    });
    expect(calls).toBe(2);
    expect(replayed).toBe(false);
    expect(result).toEqual({ ok: true });
  });

  it("different keys never collide, even for identical content", async () => {
    let runs = 0;
    const work = async () => {
      runs++;
      return { n: runs };
    };
    const a = await withIdempotency({ key: randomUUID(), operation: OPERATION, request: { same: true } }, work);
    const b = await withIdempotency({ key: randomUUID(), operation: OPERATION, request: { same: true } }, work);
    expect(runs).toBe(2);
    expect(a.result).not.toEqual(b.result);
  });
});
