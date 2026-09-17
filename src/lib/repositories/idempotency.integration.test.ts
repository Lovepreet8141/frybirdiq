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
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { idempotencyKeys } from "@/db/schema";
import { createTestOrg, deleteTestOrg, type TestOrg } from "./__test-support__/fixtures";
import { IdempotencyConflict, fingerprint, withIdempotency } from "./idempotency";

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

/**
 * idem-1 (SECURITY C1): the unique key is (key, operation) with no org, so
 * every path must refuse a row another org holds — the replay, the wait, the
 * release on failure and the final store.
 */
describe("withIdempotency across orgs", () => {
  let a: TestOrg;
  let b: TestOrg;

  beforeAll(async () => {
    a = await createTestOrg();
    b = await createTestOrg();
  });

  afterAll(async () => {
    await deleteTestOrg(a.orgId);
    await deleteTestOrg(b.orgId);
  });

  const rowFor = async (key: string) => {
    const [row] = await db()
      .select()
      .from(idempotencyKeys)
      .where(and(eq(idempotencyKeys.key, key), eq(idempotencyKeys.operation, OPERATION)));
    return row;
  };

  it("refuses another org's key with the same body instead of replaying its result, and the owner still replays", async () => {
    const key = randomUUID();
    const request = { paymentId: "same-body", amount: "9900" };
    let runs = 0;

    const first = await withIdempotency({ key, operation: OPERATION, orgId: a.orgId, request }, async () => ({ runs: ++runs, org: "a" }));
    await expect(withIdempotency({ key, operation: OPERATION, orgId: b.orgId, request }, async () => ({ runs: ++runs, org: "b" }))).rejects.toThrow(IdempotencyConflict);

    const again = await withIdempotency({ key, operation: OPERATION, orgId: a.orgId, request }, async () => ({ runs: ++runs, org: "a" }));
    expect(runs).toBe(1);
    expect(again).toEqual({ result: first.result, replayed: true });
    expect((await rowFor(key))?.orgId).toBe(a.orgId);
  });

  it("refuses another org's in-flight claim at once rather than waiting for or taking it over", async () => {
    const key = randomUUID();
    const request = { cart: "in-flight" };
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));

    const owner = withIdempotency({ key, operation: OPERATION, orgId: a.orgId, request }, async () => {
      await held;
      return { org: "a" };
    });
    // The owner's claim row is committed before its work starts waiting.
    for (let i = 0; i < 200 && !(await rowFor(key)); i++) await new Promise((resolve) => setTimeout(resolve, 10));

    const started = Date.now();
    let otherRan = false;
    await expect(
      withIdempotency({ key, operation: OPERATION, orgId: b.orgId, request }, async () => {
        otherRan = true;
        return { org: "b" };
      }),
    ).rejects.toThrow(IdempotencyConflict);
    expect(otherRan).toBe(false);
    expect(Date.now() - started).toBeLessThan(5_000);

    release();
    expect(await owner).toEqual({ result: { org: "a" }, replayed: false });
  });

  it("a takeover never releases or completes a claim another org made while its work ran", async () => {
    const key = randomUUID();
    const request = { cart: "takeover" };
    const claimAsOrgA = () => db().insert(idempotencyKeys).values({ orgId: a.orgId, key, operation: OPERATION, requestFingerprint: fingerprint({ orgId: a.orgId, request }) });

    // B holds the key first; A claims it in the gap after B's work started. B's success must not write into A's row.
    const done = await withIdempotency({ key, operation: OPERATION, orgId: b.orgId, request }, async () => {
      await db().delete(idempotencyKeys).where(and(eq(idempotencyKeys.key, key), eq(idempotencyKeys.operation, OPERATION)));
      await claimAsOrgA();
      return { org: "b" };
    });
    expect(done).toEqual({ result: { org: "b" }, replayed: false });
    let row = await rowFor(key);
    expect(row?.orgId).toBe(a.orgId);
    expect(row?.responseSnapshot).toBeNull();

    // Same gap, but B's work fails: its release must not delete A's claim.
    await db().delete(idempotencyKeys).where(and(eq(idempotencyKeys.key, key), eq(idempotencyKeys.operation, OPERATION)));
    await expect(
      withIdempotency({ key, operation: OPERATION, orgId: b.orgId, request }, async () => {
        await db().delete(idempotencyKeys).where(and(eq(idempotencyKeys.key, key), eq(idempotencyKeys.operation, OPERATION)));
        await claimAsOrgA();
        throw new Error("simulated failure");
      }),
    ).rejects.toThrow("simulated failure");
    row = await rowFor(key);
    expect(row?.orgId).toBe(a.orgId);
  });

  it("still replays a row stored before idem-1 (request-only fingerprint) to its own org, and refuses it to another", async () => {
    const key = randomUUID();
    const request = { cart: "legacy" };
    await db()
      .insert(idempotencyKeys)
      .values({ orgId: a.orgId, key, operation: OPERATION, requestFingerprint: fingerprint(request), responseSnapshot: { orderId: "stored-before" } });

    await expect(withIdempotency({ key, operation: OPERATION, orgId: b.orgId, request }, async () => ({ orderId: "b" }))).rejects.toThrow(IdempotencyConflict);
    expect(await withIdempotency({ key, operation: OPERATION, orgId: a.orgId, request }, async () => ({ orderId: "rerun" }))).toEqual({
      result: { orderId: "stored-before" },
      replayed: true,
    });
  });

  it("an org-scoped call and an org-less call never share a row", async () => {
    const key = randomUUID();
    const request = { cart: "no-org" };
    await withIdempotency({ key, operation: OPERATION, request }, async () => ({ orderId: "none" }));
    await expect(withIdempotency({ key, operation: OPERATION, orgId: a.orgId, request }, async () => ({ orderId: "a" }))).rejects.toThrow(IdempotencyConflict);
  });
});
