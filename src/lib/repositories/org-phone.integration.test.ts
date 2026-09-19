/**
 * The outlet phone path (P0-4a): unset reads as null, a valid number reads
 * back exactly, nonsense is refused and leaves the stored value alone.
 * Created under the "frybird" slug because `getStoreContact` resolves the
 * org by that slug — see `createTestOrg`.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { locations } from "@/db/schema";
import { getStoreContact } from "./org";
import { updateLocationProfile } from "./settings";
import { createTestOrg, deleteTestOrg, type TestOrg } from "./__test-support__/fixtures";

let org: TestOrg;
const profile = { addressLine1: "Shop 31-B", addressLine2: null, city: "Ambala City", pincode: "134003" } as const;

beforeAll(async () => {
  org = await createTestOrg({ slug: "frybird" });
});
afterAll(async () => {
  await deleteTestOrg(org.orgId);
});

describe("outlet phone", () => {
  it("is null when never set", async () => {
    expect((await getStoreContact())?.phone).toBeNull();
  });

  it("reads back a valid number", async () => {
    expect(await updateLocationProfile(org.orgId, { ...profile, phone: " +91 98765 43210 " })).toEqual({ ok: true });
    const [row] = await db().select({ phone: locations.phone }).from(locations).where(eq(locations.id, org.locationId));
    expect(row?.phone).toBe("+91 98765 43210");
  });

  it("refuses nonsense and keeps the stored value", async () => {
    const result = await updateLocationProfile(org.orgId, { ...profile, phone: "call us" });
    expect(result.ok).toBe(false);
    const [row] = await db().select({ phone: locations.phone }).from(locations).where(eq(locations.id, org.locationId));
    expect(row?.phone).toBe("+91 98765 43210");
  });

  it("reads a blank stored value as null, not an empty string", async () => {
    await db().update(locations).set({ phone: "" }).where(eq(locations.id, org.locationId));
    expect((await getStoreContact())?.phone).toBeNull();
  });
});
