/**
 * claimPromotionUse against a real database — this priority's fix.
 *
 * The bug: `applyPromotion` (src/lib/promotions/index.ts) checks
 * `usageCount >= usageLimit` against a snapshot read at cart-pricing time.
 * The old `countPromotionUse` incremented the counter atomically but never
 * re-checked the limit — so two orders placed close together on the same
 * near-exhausted code could both pass the stale check and both increment,
 * taking a usageLimit of 1 to 2. `claimPromotionUse` folds the check into
 * the write itself.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { promotions } from "@/db/schema";
import { claimPromotionUse } from "./promotions";
import { createTestOrg, warmPool, deleteTestOrg, type TestOrg } from "./__test-support__/fixtures";

// claimPromotionUse normalises (uppercases) the code before matching — so
// the fixture stores it already-normalised, matching how the app itself
// always writes a promotion's code.
async function createTestPromotion(org: TestOrg, code: string, usageLimit: number | null, usageCount = 0) {
  const [promo] = await db()
    .insert(promotions)
    .values({ orgId: org.orgId, code, name: `Test ${code}`, usageLimit, usageCount, isActive: true })
    .returning({ id: promotions.id });
  if (!promo) throw new Error("fixture: promotion insert returned no row");
  return promo.id;
}

describe("claimPromotionUse", () => {
  let org: TestOrg;

  beforeAll(async () => {
    org = await createTestOrg();
  });

  afterAll(async () => {
    await deleteTestOrg(org.orgId);
  });

  it("claims a slot on a code with room left", async () => {
    const code = `ROOM-${randomUUID().slice(0, 8).toUpperCase()}`;
    await createTestPromotion(org, code, 5, 2);

    const claimed = await claimPromotionUse(org.orgId, code);
    expect(claimed).toBe(true);

    const [row] = await db().select({ usageCount: promotions.usageCount }).from(promotions).where(and(eq(promotions.orgId, org.orgId), eq(promotions.code, code)));
    expect(row?.usageCount).toBe(3);
  });

  it("refuses a claim on a code already at its limit, and does not increment", async () => {
    const code = `FULL-${randomUUID().slice(0, 8).toUpperCase()}`;
    await createTestPromotion(org, code, 3, 3);

    const claimed = await claimPromotionUse(org.orgId, code);
    expect(claimed).toBe(false);

    const [row] = await db().select({ usageCount: promotions.usageCount }).from(promotions).where(and(eq(promotions.orgId, org.orgId), eq(promotions.code, code)));
    expect(row?.usageCount).toBe(3); // untouched
  });

  it("a code with no usage limit can always be claimed", async () => {
    const code = `UNLIMITED-${randomUUID().slice(0, 8).toUpperCase()}`;
    await createTestPromotion(org, code, null, 999);

    const claimed = await claimPromotionUse(org.orgId, code);
    expect(claimed).toBe(true);
  });

  it("Priority's actual design point: two concurrent claims on a code with exactly ONE slot left never both succeed", async () => {
    const code = `RACE-${randomUUID().slice(0, 8).toUpperCase()}`;
    await createTestPromotion(org, code, 5, 4); // exactly one slot remains

    await warmPool();

    const [a, b] = await Promise.all([claimPromotionUse(org.orgId, code), claimPromotionUse(org.orgId, code)]);

    const results = [a, b];
    expect(results.filter(Boolean)).toHaveLength(1); // exactly one claim won the last slot
    expect(results.filter((r) => !r)).toHaveLength(1);

    const [row] = await db().select({ usageCount: promotions.usageCount }).from(promotions).where(and(eq(promotions.orgId, org.orgId), eq(promotions.code, code)));
    expect(row?.usageCount).toBe(5); // never 6 — the limit held under real concurrency
  });
});
