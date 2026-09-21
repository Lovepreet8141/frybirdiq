/**
 * Hours through the database (migration 0051): a login reading shifts or breaks directly (PostgREST, Realtime) sees
 * only its OWN rows unless it holds staff.manage (OWNER, ADMIN). Before, every org member could read every colleague's
 * clock times, break times and correction reasons. The app already gated hours behind staff.manage; this closes the
 * database-level door too. Simulated the way Supabase does it: role `authenticated`, the user's id in the claims.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { memberships, shiftBreaks, shifts } from "@/db/schema";
import { createTestOrg, deleteTestOrg, type TestOrg } from "./__test-support__/fixtures";

let org: TestOrg;
let other: TestOrg;
const owner = randomUUID();
const admin = randomUUID();
const manager = randomUUID();
const rider = randomUUID();
const kitchen = randomUUID();
const outsider = randomUUID();
const shiftIds: Record<string, string> = {};

beforeAll(async () => {
  org = await createTestOrg();
  other = await createTestOrg();
  await db().insert(memberships).values([
    { orgId: org.orgId, userId: owner, role: "OWNER" },
    { orgId: org.orgId, userId: admin, role: "ADMIN" },
    { orgId: org.orgId, userId: manager, role: "MANAGER" },
    { orgId: org.orgId, userId: rider, role: "RIDER" },
    { orgId: org.orgId, userId: kitchen, role: "KITCHEN" },
    { orgId: other.orgId, userId: outsider, role: "OWNER" },
  ]);
  const today = new Date().toISOString().slice(0, 10);
  for (const [name, userId, o] of [["owner", owner, org], ["rider", rider, org], ["kitchen", kitchen, org], ["manager", manager, org], ["outsider", outsider, other]] as const) {
    const [s] = await db().insert(shifts).values({ orgId: o.orgId, userId, businessDate: today, clockInAt: new Date(Date.now() - 3_600_000) }).returning({ id: shifts.id });
    shiftIds[name] = s!.id;
    await db().insert(shiftBreaks).values({ orgId: o.orgId, shiftId: s!.id, startedAt: new Date(Date.now() - 1_800_000), endedAt: new Date(Date.now() - 1_500_000) });
  }
});
afterAll(async () => {
  await deleteTestOrg(org.orgId);
  await deleteTestOrg(other.orgId);
});

async function asUser<T>(userId: string, read: (q: (text: string) => Promise<Record<string, unknown>[]>) => Promise<T>): Promise<T> {
  return db().transaction(async (tx) => {
    await tx.execute(sql`select set_config('request.jwt.claim.sub', ${userId}, true)`);
    await tx.execute(sql`set local role authenticated`);
    return read(async (text) => (await tx.execute(sql.raw(text))) as unknown as Record<string, unknown>[]);
  });
}
const shiftsSeenBy = (userId: string) => asUser(userId, async (q) => (await q(`select user_id from shifts where org_id = '${org.orgId}'`)).map((r) => r.user_id as string).sort());
const breaksSeenBy = (userId: string) => asUser(userId, async (q) => (await q(`select shift_id from shift_breaks where org_id = '${org.orgId}'`)).map((r) => r.shift_id as string).sort());

describe("hours through the database", () => {
  it("a rider, a kitchen login and a manager (no staff.manage) read only their own shift and its breaks", async () => {
    expect(await shiftsSeenBy(rider)).toEqual([rider]);
    expect(await breaksSeenBy(rider)).toEqual([shiftIds.rider]);
    expect(await shiftsSeenBy(kitchen)).toEqual([kitchen]);
    expect(await breaksSeenBy(kitchen)).toEqual([shiftIds.kitchen]);
    expect(await shiftsSeenBy(manager)).toEqual([manager]);
  });

  it("the owner and an admin (staff.manage) read everyone's hours in their org, and nothing of another org", async () => {
    const everyone = [owner, rider, kitchen, manager].sort();
    expect(await shiftsSeenBy(owner)).toEqual(everyone);
    expect(await shiftsSeenBy(admin)).toEqual(everyone);
    expect((await breaksSeenBy(owner)).length).toBe(4);
    expect(await asUser(owner, (q) => q(`select id from shifts where user_id = '${outsider}'`))).toEqual([]);
  });

  it("the structure holds: both tables carry their restrictive policy", async () => {
    const rows = (await db().execute(sql`select tablename, permissive from pg_policies where schemaname = 'public' and policyname in ('shifts_role_read', 'shift_breaks_role_read')`)) as unknown as { tablename: string; permissive: string }[];
    expect(rows.map((r) => r.tablename).sort()).toEqual(["shift_breaks", "shifts"]);
    for (const r of rows) expect(r.permissive).toBe("RESTRICTIVE");
  });
});
