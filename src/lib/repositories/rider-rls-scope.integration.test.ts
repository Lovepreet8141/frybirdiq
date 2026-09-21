/**
 * rider-rls-scope (migration 0051): at the DATABASE level a rider-only login can read
 * only the deliveries assigned to it, and only the items, modifiers, events and kitchen rows of those
 * orders. Before it, migration 0042 let a RIDER read every order in the org (customer names, phones, addresses)
 * through PostgREST or Realtime with its own token. The login is simulated the way Supabase does it: the
 * `authenticated` role with the user's id in the request claims; row-level security decides. Everyone who
 * is not rider-only (owner, manager, cashier, kitchen, ...) reads what they always did, and a person who is a
 * rider AND works the counter is not narrowed.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { kitchenLineStatus, kitchenOrderPack, memberships, orderEvents, orderItemModifiers, orderItems, orders } from "@/db/schema";
import { fromRupees } from "@/lib/money";
import { createTestOrg, deleteTestOrg, type TestOrg } from "./__test-support__/fixtures";

let org: TestOrg;
let other: TestOrg;
const riderA = randomUUID();
const riderB = randomUUID();
const cashier = randomUUID();
const kitchen = randomUUID();
const manager = randomUUID();
const inventory = randomUUID();
const riderCashier = randomUUID(); // holds RIDER and CASHIER
const riderInOther = randomUUID(); // a rider of ANOTHER org
const ids: Record<string, string> = {};

beforeAll(async () => {
  org = await createTestOrg();
  other = await createTestOrg();
  await db().insert(memberships).values([
    { orgId: org.orgId, userId: riderA, role: "RIDER" },
    { orgId: org.orgId, userId: riderB, role: "RIDER" },
    { orgId: org.orgId, userId: cashier, role: "CASHIER" },
    { orgId: org.orgId, userId: kitchen, role: "KITCHEN" },
    { orgId: org.orgId, userId: manager, role: "MANAGER" },
    { orgId: org.orgId, userId: inventory, role: "INVENTORY" },
    { orgId: org.orgId, userId: riderCashier, role: "RIDER" },
    { orgId: org.orgId, userId: riderCashier, role: "CASHIER" },
    { orgId: other.orgId, userId: riderInOther, role: "RIDER" },
  ]);
  const make = async (key: string, o: TestOrg, fulfilment: "DELIVERY" | "TAKEAWAY", riderId: string | null) => {
    const [order] = await db()
      .insert(orders)
      .values({ orgId: o.orgId, locationId: o.locationId, orderNumber: `S-${key}-${randomUUID().slice(0, 4)}`, businessDate: new Date().toISOString().slice(0, 10), status: fulfilment === "DELIVERY" ? "OUT_FOR_DELIVERY" : "READY", channel: fulfilment === "DELIVERY" ? "ONLINE" : "TAKEAWAY", fulfilment, grandTotal: fromRupees("300"), customerName: `Customer ${key}`, customerPhone: "9000000001", riderId })
      .returning({ id: orders.id });
    const orderId = order!.id;
    ids[key] = orderId;
    const [item] = await db().insert(orderItems).values({ orgId: o.orgId, orderId, productName: `Item ${key}`, quantity: 1, unitPrice: fromRupees("300"), lineSubtotal: fromRupees("300"), lineTotal: fromRupees("300") }).returning({ id: orderItems.id });
    await db().insert(orderItemModifiers).values({ orgId: o.orgId, orderItemId: item!.id, groupName: "g", modifierName: `Mod ${key}` });
    await db().insert(orderEvents).values({ orgId: o.orgId, orderId, toStatus: "OUT_FOR_DELIVERY" });
    await db().insert(kitchenLineStatus).values({ orgId: o.orgId, orderId, orderItemId: item!.id, station: "FRY", doneBy: manager });
    await db().insert(kitchenOrderPack).values({ orgId: o.orgId, orderId, packedBy: manager });
  };
  await make("A", org, "DELIVERY", riderA);
  await make("B", org, "DELIVERY", riderB);
  await make("U", org, "DELIVERY", null); // unassigned
  await make("T", org, "TAKEAWAY", null);
  await make("X", other, "DELIVERY", riderInOther);
});
afterAll(async () => {
  await deleteTestOrg(org.orgId);
  await deleteTestOrg(other.orgId);
});

/** Runs reads as a signed-in staff login: role `authenticated`, the user's id in the claims, RLS in force. */
async function asUser<T>(userId: string, read: (q: (text: string) => Promise<Record<string, unknown>[]>) => Promise<T>): Promise<T> {
  return db().transaction(async (tx) => {
    await tx.execute(sql`select set_config('request.jwt.claim.sub', ${userId}, true)`);
    await tx.execute(sql`set local role authenticated`);
    const q = async (text: string) => (await tx.execute(sql.raw(text))) as unknown as Record<string, unknown>[];
    return read(q);
  });
}

const TABLES = ["orders", "order_items", "order_item_modifiers", "order_events", "kitchen_line_status", "kitchen_order_pack"] as const;
const countsFor = (userId: string) =>
  asUser(userId, async (q) => {
    const out: Record<string, number> = {};
    for (const t of TABLES) out[t] = Number((await q(`select count(*) as n from ${t} where org_id = '${org.orgId}'`))[0]!.n);
    return out;
  });

describe("a rider-only login", () => {
  it("reads only its own assigned delivery, with its items, modifiers, events and kitchen rows: not the other rider's, not an unassigned one, not a takeaway", async () => {
    for (const t of TABLES) expect((await countsFor(riderA))[t], `rider A ${t}`).toBe(1);
    const orderRows = await asUser(riderA, (q) => q(`select id, customer_phone from orders where org_id = '${org.orgId}'`));
    expect(orderRows.map((r) => r.id)).toEqual([ids.A]);
    const events = await asUser(riderA, (q) => q(`select order_id from order_events where org_id = '${org.orgId}'`));
    expect(events.map((r) => r.order_id)).toEqual([ids.A]);
  });

  it("two riders get disjoint views", async () => {
    const a = await asUser(riderA, (q) => q(`select id from orders where org_id = '${org.orgId}'`));
    const b = await asUser(riderB, (q) => q(`select id from orders where org_id = '${org.orgId}'`));
    expect(a.map((r) => r.id)).toEqual([ids.A]);
    expect(b.map((r) => r.id)).toEqual([ids.B]);
  });

  it("cannot read another org's delivery even one assigned to a rider with the same login id pattern", async () => {
    expect(await asUser(riderA, (q) => q(`select id from orders where id = '${ids.X}'`))).toEqual([]);
    expect(await asUser(riderInOther, (q) => q(`select id from orders where org_id = '${org.orgId}'`))).toEqual([]);
  });

  it("an INVENTORY-only login reads no orders at all (unchanged from 0042)", async () => {
    for (const t of TABLES) expect((await countsFor(inventory))[t], `inventory ${t}`).toBe(0);
  });
});

describe("everyone who is not rider-only keeps what they had", () => {
  it.each([
    ["cashier", cashier],
    ["kitchen", kitchen],
    ["manager", manager],
    ["a person who is both a rider and a cashier", riderCashier],
  ])("%s reads all four orders and their rows", async (_name, userId) => {
    const c = await countsFor(userId);
    expect(c.orders).toBe(4);
    expect(c.order_items).toBe(4);
    expect(c.order_events).toBe(4);
    expect(c.order_item_modifiers).toBe(4);
  });
});

describe("the database itself", () => {
  it("every table in the rider scope has a restrictive select policy, and the helper function exists", async () => {
    const rows = (await db().execute(sql`select tablename, permissive, cmd from pg_policies where schemaname = 'public' and policyname like '%\\_rider\\_scope'`)) as unknown as { tablename: string; permissive: string; cmd: string }[];
    expect(rows.map((r) => r.tablename).sort()).toEqual([...TABLES].sort());
    for (const r of rows) expect([r.permissive, r.cmd]).toEqual(["RESTRICTIVE", "SELECT"]);
    const fn = (await db().execute(sql`select count(*)::int as n from pg_proc where proname = 'auth_is_rider_scoped'`)) as unknown as { n: number }[];
    expect(fn[0]!.n).toBe(1);
  });
});
