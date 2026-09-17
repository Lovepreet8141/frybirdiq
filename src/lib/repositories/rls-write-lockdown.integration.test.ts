/**
 * 0033_rls_write_lockdown against the real local Supabase stack — PostgREST,
 * GoTrue and Postgres together, the exact path an attacker with a staff
 * login and the public anon key would use.
 *
 * Before 0033, a signed-in CASHIER could write every tenant table in their
 * own org straight through supabase-js: make themselves OWNER, deactivate
 * the real owner, flip feature flags, edit the organization, and forge
 * orders and payments. Each write below is attempted as that cashier and
 * must be refused, with the database row proven unchanged through Drizzle
 * (as `postgres`, which bypasses RLS). The reads staff screens rely on —
 * including the Realtime `postgres_changes` subscriptions on order_events —
 * must keep working, and must stay inside the cashier's own org.
 */
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { and, eq, ne } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/db";
import { featureFlags, memberships, orderEvents, orders, organizations, payments } from "@/db/schema";
import { fromRupees } from "@/lib/money";
import { createTestOrg, deleteTestOrg, type TestOrg } from "./__test-support__/fixtures";

/** Same guard as vitest.integration.setup.ts, for the HTTP side: GoTrue and PostgREST must be local too. */
function localSupabaseEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/?$/.test(url)) {
    throw new Error("rls-write-lockdown: NEXT_PUBLIC_SUPABASE_URL is not the local `supabase start` API. Refusing to run.");
  }
  if (!anonKey || !serviceKey) throw new Error("rls-write-lockdown: local anon/service keys missing from .env.test.local.");
  return { url, anonKey, serviceKey };
}

const noSession = { auth: { persistSession: false, autoRefreshToken: false } } as const;

/** Creates a confirmed local auth user through the admin API. */
async function createAuthUser(admin: SupabaseClient, email: string, password: string): Promise<string> {
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) throw new Error(`rls-write-lockdown: createUser failed: ${error?.message}`);
  return data.user.id;
}

/** A supabase-js client holding a real user session, built from the public anon key — what a browser would have. */
async function signInWithAnonKey(email: string, password: string): Promise<SupabaseClient> {
  const { url, anonKey } = localSupabaseEnv();
  const client = createClient(url, anonKey, noSession);
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`rls-write-lockdown: sign-in failed: ${error.message}`);
  return client;
}

async function createOrder(org: TestOrg): Promise<string> {
  const [order] = await db()
    .insert(orders)
    .values({
      orgId: org.orgId,
      locationId: org.locationId,
      orderNumber: `TEST-${randomUUID().slice(0, 8)}`,
      businessDate: new Date().toISOString().slice(0, 10),
      status: "PENDING_PAYMENT",
      channel: "DINE_IN",
      fulfilment: "DINE_IN",
      grandTotal: fromRupees("300"),
    })
    .returning({ id: orders.id });
  if (!order) throw new Error("rls-write-lockdown: order insert returned no row");
  await db().insert(orderEvents).values({ orgId: org.orgId, orderId: order.id, toStatus: "PENDING_PAYMENT" });
  return order.id;
}

/** A refused write: PostgREST returns 42501 once the privilege is revoked. */
function expectRefused(result: { error: { code?: string } | null }) {
  expect(result.error).not.toBeNull();
  expect(result.error?.code).toBe("42501");
}

describe("0033 — client-side writes are refused, tenant reads still work", () => {
  let admin: SupabaseClient;
  let cashier: SupabaseClient;
  let org: TestOrg;
  let otherOrg: TestOrg;
  let ownerId: string;
  let cashierId: string;
  let orderId: string;
  let otherOrderId: string;
  let paymentId: string;
  const password = `pw-${randomUUID()}`;
  const flagKey = `lockdown-${randomUUID().slice(0, 8)}`;

  beforeAll(async () => {
    const { url, serviceKey } = localSupabaseEnv();
    admin = createClient(url, serviceKey, noSession);

    org = await createTestOrg();
    otherOrg = await createTestOrg();

    const suffix = randomUUID().slice(0, 8);
    ownerId = await createAuthUser(admin, `owner-${suffix}@lockdown.test`, password);
    cashierId = await createAuthUser(admin, `cashier-${suffix}@lockdown.test`, password);
    await db().insert(memberships).values([
      { orgId: org.orgId, userId: ownerId, role: "OWNER" },
      { orgId: org.orgId, userId: cashierId, role: "CASHIER" },
    ]);
    await db().insert(featureFlags).values({ orgId: org.orgId, key: flagKey, isEnabled: false });

    orderId = await createOrder(org);
    otherOrderId = await createOrder(otherOrg);
    const [payment] = await db()
      .insert(payments)
      .values({ orgId: org.orgId, orderId, method: "CASH", amount: fromRupees("300"), provider: "cash" })
      .returning({ id: payments.id });
    if (!payment) throw new Error("rls-write-lockdown: payment insert returned no row");
    paymentId = payment.id;

    cashier = await signInWithAnonKey(`cashier-${suffix}@lockdown.test`, password);
  });

  /**
   * Puts the fixture back after every attempt, so each test proves its own
   * attack independently — on a schema without 0033 a write that got through
   * (a self-inserted OWNER row, a forged order) would otherwise leak into the
   * next test and blur which attack actually succeeded.
   */
  afterEach(async () => {
    await db().delete(memberships).where(eq(memberships.orgId, org.orgId));
    await db().insert(memberships).values([
      { orgId: org.orgId, userId: ownerId, role: "OWNER" },
      { orgId: org.orgId, userId: cashierId, role: "CASHIER" },
    ]);
    await db().update(featureFlags).set({ isEnabled: false }).where(eq(featureFlags.orgId, org.orgId));
    await db().update(organizations).set({ name: `Integration Test ${org.slug}` }).where(eq(organizations.id, org.orgId));
    await db().delete(payments).where(and(eq(payments.orgId, org.orgId), ne(payments.id, paymentId)));
    await db().update(payments).set({ status: "PENDING" }).where(eq(payments.id, paymentId));
    await db().delete(orders).where(and(eq(orders.orgId, org.orgId), ne(orders.id, orderId)));
    await db().update(orders).set({ status: "PENDING_PAYMENT" }).where(eq(orders.id, orderId));
  });

  afterAll(async () => {
    await cashier?.auth.signOut();
    // payments.order_id is ON DELETE RESTRICT, so clear payments before the org cascade reaches orders.
    if (org) await db().delete(payments).where(eq(payments.orgId, org.orgId));
    if (org) await deleteTestOrg(org.orgId);
    if (otherOrg) await deleteTestOrg(otherOrg.orgId);
    for (const id of [ownerId, cashierId]) if (id) await admin.auth.admin.deleteUser(id);
  });

  it("refuses a cashier inserting an OWNER membership for themselves", async () => {
    expectRefused(await cashier.from("memberships").insert({ org_id: org.orgId, user_id: cashierId, role: "OWNER" }));
    const rows = await db()
      .select()
      .from(memberships)
      .where(and(eq(memberships.orgId, org.orgId), eq(memberships.userId, cashierId)));
    expect(rows.map((row) => row.role)).toEqual(["CASHIER"]);
  });

  it("refuses a cashier promoting their own membership to OWNER", async () => {
    expectRefused(await cashier.from("memberships").update({ role: "OWNER" }).eq("user_id", cashierId).eq("org_id", org.orgId));
    const [row] = await db()
      .select({ role: memberships.role })
      .from(memberships)
      .where(and(eq(memberships.orgId, org.orgId), eq(memberships.userId, cashierId)));
    expect(row?.role).toBe("CASHIER");
  });

  it("refuses a cashier deactivating the owner", async () => {
    expectRefused(await cashier.from("memberships").update({ is_active: false }).eq("user_id", ownerId).eq("org_id", org.orgId));
    const [row] = await db()
      .select({ isActive: memberships.isActive })
      .from(memberships)
      .where(and(eq(memberships.orgId, org.orgId), eq(memberships.userId, ownerId)));
    expect(row?.isActive).toBe(true);
  });

  it("refuses a cashier flipping a feature flag", async () => {
    expectRefused(await cashier.from("feature_flags").update({ is_enabled: true }).eq("org_id", org.orgId).eq("key", flagKey));
    const [row] = await db()
      .select({ isEnabled: featureFlags.isEnabled })
      .from(featureFlags)
      .where(and(eq(featureFlags.orgId, org.orgId), eq(featureFlags.key, flagKey)));
    expect(row?.isEnabled).toBe(false);
  });

  it("refuses a cashier editing the organization", async () => {
    expectRefused(await cashier.from("organizations").update({ name: "Taken over" }).eq("id", org.orgId));
    const [row] = await db().select({ name: organizations.name }).from(organizations).where(eq(organizations.id, org.orgId));
    expect(row?.name).toBe(`Integration Test ${org.slug}`);
  });

  it("refuses a cashier inserting or updating a payment", async () => {
    expectRefused(
      await cashier
        .from("payments")
        .insert({ org_id: org.orgId, order_id: orderId, method: "CASH", status: "CAPTURED", amount: 30000, provider: "forged" }),
    );
    expectRefused(await cashier.from("payments").update({ status: "CAPTURED" }).eq("id", paymentId));
    const rows = await db().select().from(payments).where(eq(payments.orderId, orderId));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe("PENDING");
  });

  it("refuses a cashier inserting or updating an order", async () => {
    expectRefused(
      await cashier.from("orders").insert({
        org_id: org.orgId,
        location_id: org.locationId,
        order_number: `FORGED-${randomUUID().slice(0, 8)}`,
        business_date: new Date().toISOString().slice(0, 10),
        status: "PAID",
        channel: "DINE_IN",
        fulfilment: "DINE_IN",
        grand_total: 0,
      }),
    );
    expectRefused(await cashier.from("orders").update({ status: "PAID" }).eq("id", orderId));
    const rows = await db().select({ status: orders.status }).from(orders).where(eq(orders.orgId, org.orgId));
    expect(rows).toEqual([{ status: "PENDING_PAYMENT" }]);
  });

  it("still lets the cashier read their own org's orders, order events, memberships, flags and organization", async () => {
    const ownOrders = await cashier.from("orders").select("id").eq("org_id", org.orgId);
    expect(ownOrders.error).toBeNull();
    expect(ownOrders.data?.map((row) => row.id)).toEqual([orderId]);

    const ownEvents = await cashier.from("order_events").select("order_id, to_status").eq("order_id", orderId);
    expect(ownEvents.error).toBeNull();
    expect(ownEvents.data).toEqual([{ order_id: orderId, to_status: "PENDING_PAYMENT" }]);

    const ownMemberships = await cashier.from("memberships").select("user_id").eq("org_id", org.orgId);
    expect(ownMemberships.error).toBeNull();
    expect(ownMemberships.data).toHaveLength(2);

    const ownFlags = await cashier.from("feature_flags").select("key").eq("org_id", org.orgId);
    expect(ownFlags.error).toBeNull();
    expect(ownFlags.data).toEqual([{ key: flagKey }]);

    const ownOrg = await cashier.from("organizations").select("id").eq("id", org.orgId);
    expect(ownOrg.error).toBeNull();
    expect(ownOrg.data).toEqual([{ id: org.orgId }]);
  });

  it("never lets the cashier read another org's rows", async () => {
    const foreignOrders = await cashier.from("orders").select("id").eq("id", otherOrderId);
    expect(foreignOrders.error).toBeNull();
    expect(foreignOrders.data).toEqual([]);

    const foreignEvents = await cashier.from("order_events").select("id").eq("org_id", otherOrg.orgId);
    expect(foreignEvents.error).toBeNull();
    expect(foreignEvents.data).toEqual([]);

    const foreignOrg = await cashier.from("organizations").select("id").eq("id", otherOrg.orgId);
    expect(foreignOrg.error).toBeNull();
    expect(foreignOrg.data).toEqual([]);
  });

  it("refuses writes from the bare anon key too", async () => {
    const { url, anonKey } = localSupabaseEnv();
    const anon = createClient(url, anonKey, noSession);
    expectRefused(await anon.from("memberships").insert({ org_id: org.orgId, user_id: randomUUID(), role: "OWNER" }));
  });
});
