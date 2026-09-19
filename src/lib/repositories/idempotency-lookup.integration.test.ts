/**
 * findIdempotentResult: the read-only "has this exact request already been
 * completed?" lookup placeOrder uses before the opening-hours refusals, so a
 * lost-response retry after closing time gets the order that exists instead of
 * a false "kitchen is closed".
 */
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { idempotencyKeys } from "@/db/schema";
import { createTestOrg, deleteTestOrg, type TestOrg } from "./__test-support__/fixtures";
import { findIdempotentResult, withIdempotency } from "./idempotency";

const OPERATION = "lookup_integration_test_op";

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
afterEach(async () => {
  await db().delete(idempotencyKeys).where(eq(idempotencyKeys.operation, OPERATION));
});

const rowCount = async () => (await db().select().from(idempotencyKeys).where(eq(idempotencyKeys.operation, OPERATION))).length;

describe("findIdempotentResult", () => {
  it("returns the stored result for the same org, operation, key and request", async () => {
    const key = randomUUID();
    const request = { cart: "x" };
    const { result } = await withIdempotency({ key, operation: OPERATION, orgId: a.orgId, request }, async () => ({ orderId: "o1" }));
    expect(await findIdempotentResult({ key, operation: OPERATION, orgId: a.orgId, request })).toEqual(result);
  });

  it("returns null for the same key with a different request", async () => {
    const key = randomUUID();
    await withIdempotency({ key, operation: OPERATION, orgId: a.orgId, request: { cart: "x" } }, async () => ({ orderId: "o1" }));
    expect(await findIdempotentResult({ key, operation: OPERATION, orgId: a.orgId, request: { cart: "y" } })).toBeNull();
  });

  it("returns null for another org, and for an unknown key or operation", async () => {
    const key = randomUUID();
    const request = { cart: "x" };
    await withIdempotency({ key, operation: OPERATION, orgId: a.orgId, request }, async () => ({ orderId: "o1" }));
    expect(await findIdempotentResult({ key, operation: OPERATION, orgId: b.orgId, request })).toBeNull();
    expect(await findIdempotentResult({ key: randomUUID(), operation: OPERATION, orgId: a.orgId, request })).toBeNull();
    expect(await findIdempotentResult({ key, operation: "other_op", orgId: a.orgId, request })).toBeNull();
  });

  it("returns null for an in-flight claim that has no result yet", async () => {
    const key = randomUUID();
    const request = { cart: "x" };
    let seen: unknown = "unset";
    await withIdempotency({ key, operation: OPERATION, orgId: a.orgId, request }, async () => {
      seen = await findIdempotentResult({ key, operation: OPERATION, orgId: a.orgId, request });
      return { orderId: "o1" };
    });
    expect(seen).toBeNull();
  });

  it("never inserts, updates or deletes a row", async () => {
    const key = randomUUID();
    const request = { cart: "x" };
    expect(await findIdempotentResult({ key, operation: OPERATION, orgId: a.orgId, request })).toBeNull();
    expect(await rowCount()).toBe(0);
    await withIdempotency({ key, operation: OPERATION, orgId: a.orgId, request }, async () => ({ orderId: "o1" }));
    const before = await db().select().from(idempotencyKeys).where(eq(idempotencyKeys.operation, OPERATION));
    await findIdempotentResult({ key, operation: OPERATION, orgId: a.orgId, request });
    await findIdempotentResult({ key, operation: OPERATION, orgId: b.orgId, request });
    expect(await db().select().from(idempotencyKeys).where(eq(idempotencyKeys.operation, OPERATION))).toEqual(before);
  });
});
