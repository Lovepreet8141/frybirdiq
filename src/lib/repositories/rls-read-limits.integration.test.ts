/**
 * 0042_rls_role_reads against the real local Supabase stack (GoTrue + PostgREST
 * + Postgres): the exact path a staff login holding the public anon key would
 * use. Before 0042 every active member of an org could read customers,
 * payments, refunds, the books and every other member's PIN hash through
 * PostgREST whatever their role (p0-7, defect 2). One real login per role:
 * each may read exactly the tables its permissions name (src/domain/
 * rls-read-limits.ts), the menu tables Realtime needs stay readable by
 * everyone, another org's rows never appear, and a member sees only their own
 * membership row unless they hold staff.manage.
 */
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/db";
import { cashSessions, memberships, orderEvents, orders, payments } from "@/db/schema";
import { ALREADY_ROLE_AWARE, MEMBERSHIPS_READABLE_COLUMNS, CHILD_READ_LIMITS, OPEN_TO_MEMBERS_ON_PURPOSE, OWN_ROW_LIMITS_0047, permissionsReadingAll0047, MEMBERSHIPS_READ, READ_LIMITS, READ_LIMITS_0047, policies0047, readLimitPolicies, rolesHoldingAny } from "@/domain/rls-read-limits";
import { ROLES, type Role } from "@/domain/permissions";
import { fromRupees } from "@/lib/money";
import { createTestCustomer, createTestOrg, createTestProduct, deleteTestOrg, type TestOrg } from "./__test-support__/fixtures";

const sharedStackOnly = describe.skipIf(Boolean(process.env.FRYBIRD_TEST_DB));
const noSession = { auth: { persistSession: false, autoRefreshToken: false } } as const;

function localEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/?$/.test(url)) throw new Error("rls-read-limits: NEXT_PUBLIC_SUPABASE_URL is not the local stack. Refusing to run.");
  if (!anonKey || !serviceKey) throw new Error("rls-read-limits: local anon/service keys missing from .env.test.local.");
  return { url, anonKey, serviceKey };
}

sharedStackOnly("0042: staff reads through the database are limited by role", () => {
  let org: TestOrg;
  let other: TestOrg;
  const clients = new Map<Role, SupabaseClient>();
  const userIds = new Map<Role, string>();
  const password = `pw-${randomUUID()}`;
  const suffix = randomUUID().slice(0, 8);

  beforeAll(async () => {
    const { url, anonKey, serviceKey } = localEnv();
    const admin = createClient(url, serviceKey, noSession);
    org = await createTestOrg();
    other = await createTestOrg();

    for (const role of ROLES) {
      const email = `${role.toLowerCase()}-${suffix}@readlimits.test`;
      const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
      if (error || !data.user) throw new Error(`createUser ${role}: ${error?.message}`);
      userIds.set(role, data.user.id);
      await db().insert(memberships).values({ orgId: org.orgId, userId: data.user.id, role, displayName: role, posPinHash: `pin-hash-${role}` });
      const client = createClient(url, anonKey, noSession);
      const signIn = await client.auth.signInWithPassword({ email, password });
      if (signIn.error) throw new Error(`sign-in ${role}: ${signIn.error.message}`);
      clients.set(role, client);
    }

    // One row of each kind in this org, and one of the customers in another org.
    await createTestCustomer(org.orgId);
    await createTestCustomer(other.orgId);
    await createTestProduct(org.orgId);
    const [order] = await db()
      .insert(orders)
      .values({ orgId: org.orgId, locationId: org.locationId, orderNumber: `RL-${suffix}`, businessDate: new Date().toISOString().slice(0, 10), status: "PENDING_PAYMENT", channel: "DINE_IN", fulfilment: "DINE_IN", grandTotal: fromRupees("300") })
      .returning({ id: orders.id });
    await db().insert(orderEvents).values({ orgId: org.orgId, orderId: order!.id, toStatus: "PENDING_PAYMENT" });
    await db().insert(payments).values({ orgId: org.orgId, orderId: order!.id, method: "CASH", amount: fromRupees("300"), provider: "cash" });
    await db().insert(cashSessions).values({ orgId: org.orgId, locationId: org.locationId, openedBy: userIds.get("OWNER")!, openingFloat: fromRupees("100") });
  });

  afterAll(async () => {
    const { url, serviceKey } = localEnv();
    const admin = createClient(url, serviceKey, noSession);
    for (const id of userIds.values()) await admin.auth.admin.deleteUser(id);
    await deleteTestOrg(org.orgId);
    await deleteTestOrg(other.orgId);
  });

  const visibleRows = async (role: Role, table: string, orgId = org.orgId): Promise<number> => {
    const { data, error } = await clients.get(role)!.from(table).select("id").eq("org_id", orgId);
    if (error) throw new Error(`${role} reading ${table}: ${error.message}`);
    return data?.length ?? 0;
  };

  it("payments and customers: only the roles holding the permission see any row", async () => {
    for (const role of ROLES) {
      expect(await visibleRows(role, "payments"), `${role} payments`).toBe(rolesHoldingAny(READ_LIMITS.payments!).includes(role) ? 1 : 0);
      expect(await visibleRows(role, "customers"), `${role} customers`).toBe(rolesHoldingAny(READ_LIMITS.customers!).includes(role) ? 1 : 0);
      expect(await visibleRows(role, "cash_sessions"), `${role} cash_sessions`).toBe(rolesHoldingAny(READ_LIMITS.cash_sessions!).includes(role) ? 1 : 0);
    }
  });

  it("the named cases: CASHIER, KITCHEN, RIDER, ADMIN, INVENTORY and ANALYST cannot read payments; KITCHEN and RIDER cannot read customers; the owner and manager can read payments", async () => {
    for (const role of ["CASHIER", "KITCHEN", "RIDER", "ADMIN", "INVENTORY", "ANALYST"] as const) expect(await visibleRows(role, "payments"), role).toBe(0);
    for (const role of ["KITCHEN", "RIDER"] as const) expect(await visibleRows(role, "customers"), role).toBe(0);
    for (const role of ["OWNER", "MANAGER"] as const) expect(await visibleRows(role, "payments"), role).toBe(1);
  });

  it("the screens Realtime feeds keep working: order_events for the order, kitchen and delivery roles, menu tables for everyone", async () => {
    // 0052 (rider-rls-scope): a rider-only login reads only events of ITS OWN deliveries, so this dine-in order's event is
    // not visible to a RIDER (rider-rls-scope.integration.test.ts pins the rider side in full); everyone else is unchanged.
    for (const role of ["OWNER", "MANAGER", "CASHIER", "KITCHEN"] as const) expect(await visibleRows(role, "order_events"), `${role} order_events`).toBe(1);
    expect(await visibleRows("RIDER", "order_events"), "RIDER order_events (not assigned to it)").toBe(0);
    for (const role of ROLES) {
      expect(await visibleRows(role, "products"), `${role} products`).toBe(1);
      const expected = role === "RIDER" ? 0 : rolesHoldingAny(READ_LIMITS.order_events!).includes(role) ? 1 : 0;
      expect(await visibleRows(role, "order_events")).toBe(expected);
    }
  });

  it("another organization's rows never appear, for any role", async () => {
    for (const role of ROLES) {
      expect(await visibleRows(role, "customers", other.orgId), role).toBe(0);
      expect(await visibleRows(role, "products", other.orgId), role).toBe(0);
    }
  });

  it("memberships: everyone reads their own row (no PIN hash leaks to others); only staff.manage roles read the roster", async () => {
    const managers = rolesHoldingAny(MEMBERSHIPS_READ);
    for (const role of ROLES) {
      const { data, error } = await clients.get(role)!.from("memberships").select("user_id, role").eq("org_id", org.orgId);
      if (error) throw new Error(error.message);
      const rows = data ?? [];
      if (managers.includes(role)) expect(rows.length, `${role} roster`).toBe(ROLES.length);
      else expect(rows.map((r) => r.user_id), `${role} sees only itself`).toEqual([userIds.get(role)]);
    }
  });

  it("every table a policy names has the org_id column it filters on (a child table goes through its parent)", async () => {
    const rows = (await db().execute(sql`select table_name from information_schema.columns where table_schema = 'public' and column_name = 'org_id'`)) as unknown as { table_name: string }[];
    const withOrg = new Set(rows.map((r) => r.table_name));
    for (const table of [...Object.keys(READ_LIMITS), ...Object.keys(READ_LIMITS_0047), ...Object.keys(OWN_ROW_LIMITS_0047)]) expect(withOrg.has(table), `${table} has org_id`).toBe(true);
    for (const table of Object.keys(CHILD_READ_LIMITS)) expect(withOrg.has(table), `${table} has no org_id of its own`).toBe(false);
  });

  it("the PIN hash is not readable through the database by any login, the owner included; the other membership columns are", async () => {
    for (const role of ROLES) {
      const hash = await clients.get(role)!.from("memberships").select("pos_pin_hash").eq("org_id", org.orgId);
      expect(hash.error?.code, `${role} pos_pin_hash`).toBe("42501");
      const ok = await clients.get(role)!.from("memberships").select("user_id, role").eq("org_id", org.orgId);
      expect(ok.error, `${role} other columns`).toBeNull();
    }
    const cols = (await db().execute(sql`select column_name from information_schema.columns where table_schema = 'public' and table_name = 'memberships'`)) as unknown as { column_name: string }[];
    expect(cols.map((c) => c.column_name).filter((c) => c !== "pos_pin_hash").sort(), "a new memberships column must be added to MEMBERSHIPS_READABLE_COLUMNS or left unreadable on purpose").toEqual([...MEMBERSHIPS_READABLE_COLUMNS].sort());
  });

  it("no table is open to every member by accident: each is restricted, already role-aware, open on purpose, or has no client policy at all", async () => {
    const tables = (await db().execute(sql`select c.relname as t, (select count(*) from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname) as policies from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'`)) as unknown as { t: string; policies: string }[];
    const decided = new Set([...Object.keys(READ_LIMITS), ...Object.keys(READ_LIMITS_0047), ...Object.keys(OWN_ROW_LIMITS_0047), ...Object.keys(CHILD_READ_LIMITS), "memberships", ...ALREADY_ROLE_AWARE, ...Object.keys(OPEN_TO_MEMBERS_ON_PURPOSE)]);
    const undecided = tables.filter((row) => Number(row.policies) > 0 && !decided.has(row.t)).map((row) => row.t);
    expect(undecided, "add each to READ_LIMITS, or to OPEN_TO_MEMBERS_ON_PURPOSE with a reason").toEqual([]);
  });

  it("every restricted table carries its restrictive policy with exactly the roles the permissions table names", async () => {
    const rows = (await db().execute(sql`select tablename, policyname, permissive, cmd, qual from pg_policies where schemaname = 'public' and policyname like '%\\_role\\_read'`)) as unknown as { tablename: string; policyname: string; permissive: string; cmd: string; qual: string }[];
    const byTable = new Map(rows.map((r) => [r.tablename, r]));
    for (const { table, policy } of readLimitPolicies()) {
      const row = byTable.get(table);
      expect(row, `${table} has ${policy}`).toBeDefined();
      expect(row!.permissive).toBe("RESTRICTIVE");
      expect(row!.cmd).toBe("SELECT");
      const roles = table === "memberships" ? rolesHoldingAny(MEMBERSHIPS_READ) : rolesHoldingAny(READ_LIMITS[table] ?? CHILD_READ_LIMITS[table]!.permissions);
      for (const role of ROLES) expect(row!.qual.includes(`'${role}'::text`), `${table} ${role}`).toBe(roles.includes(role));
    }
    for (const { table, policy } of policies0047()) {
      const row = byTable.get(table);
      expect(row, `${table} has ${policy}`).toBeDefined();
      expect(row!.permissive).toBe("RESTRICTIVE");
      for (const role of ROLES) expect(row!.qual.includes(`'${role}'::text`), `${table} ${role}`).toBe(rolesHoldingAny(permissionsReadingAll0047(table)).includes(role));
    }
    expect(rows.length).toBe(readLimitPolicies().length + policies0047().length);
    void eq;
  });
});
