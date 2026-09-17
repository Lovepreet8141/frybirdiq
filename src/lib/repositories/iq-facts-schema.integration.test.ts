/**
 * 0036_iq_facts against the real local Supabase stack: grants, RLS, the
 * uniqueness the delete+insert recompute relies on, the CHECKs, and the
 * read-path indexes. The fact repositories and their parity test are
 * ANALYTICS-DATA's (iq-facts / iq-pnl-parity integration tests).
 */
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/db";
import { iqDailyFacts, iqDailyTrust, iqIntradayFacts, memberships } from "@/db/schema";
import { createTestOrg, deleteTestOrg, type TestOrg } from "./__test-support__/fixtures";

/**
 * GoTrue and PostgREST serve only the shared `postgres` database. On a
 * per-worktree test database (hive/tools/test-db.sh sets FRYBIRD_TEST_DB) the
 * users and rows these suites create would land in different databases, so
 * they skip; run them on the shared stack with merged migrations only.
 */
const sharedStackOnly = describe.skipIf(Boolean(process.env.FRYBIRD_TEST_DB));

const TABLES = ["iq_daily_facts", "iq_intraday_facts", "iq_daily_trust"] as const;
const PRIVILEGES = ["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER"] as const;

async function sqlState(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
  } catch (error) {
    const e = error as { code?: string; cause?: { code?: string } };
    return e.cause?.code ?? e.code;
  }
  return undefined;
}

function localSupabaseEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/?$/.test(url)) {
    throw new Error("iq-facts-schema: NEXT_PUBLIC_SUPABASE_URL is not the local `supabase start` API. Refusing to run.");
  }
  if (!anonKey || !serviceKey) throw new Error("iq-facts-schema: local anon/service keys missing from .env.test.local.");
  return { url, anonKey, serviceKey };
}

const noSession = { auth: { persistSession: false, autoRefreshToken: false } } as const;

function fact(org: TestOrg, overrides: Partial<typeof iqDailyFacts.$inferInsert> = {}): typeof iqDailyFacts.$inferInsert {
  return {
    orgId: org.orgId,
    businessDate: "2026-09-01",
    metricId: "revenue_net",
    unit: "paise",
    value: 94_29n,
    definitionVersion: 1,
    ...overrides,
  };
}

describe("0036 — grants and row-level security", () => {
  it("anon holds nothing; authenticated holds only SELECT on the three fact tables", async () => {
    const rows = await db().execute<{ table_name: string; role: string; privilege: string; granted: boolean }>(sql`
      SELECT t.table_name, r.role, p.privilege,
             has_table_privilege(r.role, format('public.%I', t.table_name), p.privilege) AS granted
      FROM unnest(${sql.raw(`ARRAY[${TABLES.map((t) => `'${t}'`).join(", ")}]`)}::text[]) AS t(table_name)
      CROSS JOIN unnest(ARRAY['anon', 'authenticated']) AS r(role)
      CROSS JOIN unnest(${sql.raw(`ARRAY[${PRIVILEGES.map((p) => `'${p}'`).join(", ")}]`)}::text[]) AS p(privilege)
    `);
    expect(rows.length).toBe(TABLES.length * 2 * PRIVILEGES.length);
    for (const row of rows) {
      expect({ ...row, granted: row.granted }).toEqual({ ...row, granted: row.role === "authenticated" && row.privilege === "SELECT" });
    }
  });

  it("RLS is enabled and forced, with one SELECT policy per table", async () => {
    const tables = await db().execute<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>(sql`
      SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class
      WHERE relnamespace = 'public'::regnamespace AND relname IN ('iq_daily_facts', 'iq_intraday_facts', 'iq_daily_trust')
      ORDER BY relname
    `);
    expect(tables.map((t) => [t.relname, t.relrowsecurity, t.relforcerowsecurity])).toEqual([
      ["iq_daily_facts", true, true],
      ["iq_daily_trust", true, true],
      ["iq_intraday_facts", true, true],
    ]);
    const policies = await db().execute<{ tablename: string; policyname: string; cmd: string }>(sql`
      SELECT tablename, policyname, cmd FROM pg_policies
      WHERE schemaname = 'public' AND tablename IN ('iq_daily_facts', 'iq_intraday_facts', 'iq_daily_trust') ORDER BY tablename
    `);
    expect(policies.map((p) => [p.tablename, p.policyname, p.cmd])).toEqual([
      ["iq_daily_facts", "iq_daily_facts_finance_read", "SELECT"],
      ["iq_daily_trust", "iq_daily_trust_finance_read", "SELECT"],
      ["iq_intraday_facts", "iq_intraday_facts_finance_read", "SELECT"],
    ]);
  });
});

sharedStackOnly("0036 — who reads facts through PostgREST", () => {
  let admin: SupabaseClient;
  const sessions = new Map<string, SupabaseClient>();
  const userIds: string[] = [];
  let org: TestOrg;
  let otherOrg: TestOrg;
  let ownFactId: string;

  beforeAll(async () => {
    const { url, anonKey, serviceKey } = localSupabaseEnv();
    admin = createClient(url, serviceKey, noSession);
    org = await createTestOrg();
    otherOrg = await createTestOrg();
    const [own] = await db().insert(iqDailyFacts).values(fact(org)).returning({ id: iqDailyFacts.id });
    ownFactId = own!.id;
    await db().insert(iqDailyFacts).values(fact(otherOrg));

    const password = `pw-${randomUUID()}`;
    const suffix = randomUUID().slice(0, 8);
    for (const role of ["OWNER", "MANAGER", "ADMIN", "CASHIER", "ANALYST"] as const) {
      const email = `${role.toLowerCase()}-${suffix}@iq-facts.test`;
      const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
      if (error || !data.user) throw new Error(`iq-facts-schema: createUser failed: ${error?.message}`);
      userIds.push(data.user.id);
      await db().insert(memberships).values({ orgId: org.orgId, userId: data.user.id, role });
      const client = createClient(url, anonKey, noSession);
      const signedIn = await client.auth.signInWithPassword({ email, password });
      if (signedIn.error) throw new Error(`iq-facts-schema: sign-in failed: ${signedIn.error.message}`);
      sessions.set(role, client);
    }
  });

  afterAll(async () => {
    for (const client of sessions.values()) await client.auth.signOut();
    if (org) await deleteTestOrg(org.orgId);
    if (otherOrg) await deleteTestOrg(otherOrg.orgId);
    for (const id of userIds) await admin.auth.admin.deleteUser(id);
  });

  it("OWNER and MANAGER read their own org's facts, never another org's", async () => {
    for (const role of ["OWNER", "MANAGER"]) {
      const { data, error } = await sessions.get(role)!.from("iq_daily_facts").select("id");
      expect([role, error, data]).toEqual([role, null, [{ id: ownFactId }]]);
    }
  });

  it("ADMIN, CASHIER and ANALYST (no finance.view) read nothing", async () => {
    for (const role of ["ADMIN", "CASHIER", "ANALYST"]) {
      for (const table of TABLES) {
        const { data, error } = await sessions.get(role)!.from(table).select("id");
        expect([role, table, error, data]).toEqual([role, table, null, []]);
      }
    }
  });

  it("nobody writes through a Supabase key, and the bare anon key reads nothing", async () => {
    const write = await sessions.get("OWNER")!.from("iq_daily_facts").update({ value: 1 }).eq("id", ownFactId);
    expect(write.error?.code).toBe("42501");
    const { url, anonKey } = localSupabaseEnv();
    const anon = createClient(url, anonKey, noSession);
    expect((await anon.from("iq_daily_facts").select("id")).error?.code).toBe("42501");
  });
});

describe("0036 — keys and CHECKs", () => {
  let org: TestOrg;

  beforeAll(async () => {
    org = await createTestOrg();
  });

  afterAll(async () => {
    if (org) await deleteTestOrg(org.orgId);
  });

  it("one daily fact per key, an org-wide (null location) row included; a new version sits beside the old", async () => {
    await db().insert(iqDailyFacts).values(fact(org));
    expect(await sqlState(db().insert(iqDailyFacts).values(fact(org)))).toBe("23505");
    await db().insert(iqDailyFacts).values(fact(org, { definitionVersion: 2 }));
    await db().insert(iqDailyFacts).values(fact(org, { locationId: org.locationId }));
    expect(await sqlState(db().insert(iqDailyFacts).values(fact(org, { locationId: org.locationId })))).toBe("23505");
    await db().insert(iqDailyFacts).values(fact(org, { metricId: "revenue_net_by_product", dimensionKey: "product", dimensionValue: "__fees__" }));
  });

  it("refuses malformed ids, half a dimension, unknown units and negative counts; allows a negative value", async () => {
    const date = "2026-09-02";
    expect(await sqlState(db().insert(iqDailyFacts).values(fact(org, { businessDate: date, metricId: "Revenue Net" })))).toBe("23514");
    expect(await sqlState(db().insert(iqDailyFacts).values(fact(org, { businessDate: date, dimensionKey: "channel" })))).toBe("23514");
    expect(await sqlState(db().insert(iqDailyFacts).values(fact(org, { businessDate: date, dimensionValue: "DINE_IN" })))).toBe("23514");
    expect(await sqlState(db().insert(iqDailyFacts).values(fact(org, { businessDate: date, unit: "bps" })))).toBe("23514");
    expect(await sqlState(db().insert(iqDailyFacts).values(fact(org, { businessDate: date, sourceRowCount: -1 })))).toBe("23514");
    expect(await sqlState(db().insert(iqDailyFacts).values(fact(org, { businessDate: date, definitionVersion: 0 })))).toBe("23514");
    await db().insert(iqDailyFacts).values(fact(org, { businessDate: date, metricId: "refunds_amount", value: -500n }));
  });

  it("an intraday bucket is a quarter-hour whose IST day is the business date", async () => {
    const intraday = (bucketStart: string, businessDate: string) =>
      db()
        .insert(iqIntradayFacts)
        .values({ ...fact(org, { businessDate }), bucketStart: new Date(bucketStart) });
    // 23:45 IST on 1 Sep is 18:15 UTC.
    await intraday("2026-09-01T18:15:00Z", "2026-09-01");
    expect(await sqlState(intraday("2026-09-01T18:15:00Z", "2026-09-01"))).toBe("23505");
    // 00:00 IST on 2 Sep is 18:30 UTC on 1 Sep.
    await intraday("2026-09-01T18:30:00Z", "2026-09-02");
    expect(await sqlState(intraday("2026-09-01T18:30:00Z", "2026-09-01"))).toBe("23514");
    expect(await sqlState(intraday("2026-09-01T18:20:00Z", "2026-09-01"))).toBe("23514");
  });

  it("trust rows: one per key, known grades, non-negative counts, detail holds numbers only", async () => {
    const trust = (overrides: Partial<typeof iqDailyTrust.$inferInsert> = {}) =>
      db()
        .insert(iqDailyTrust)
        .values({ orgId: org.orgId, businessDate: "2026-09-01", signalId: "t6_payment_integrity", grade: "HIGH", definitionVersion: 1, ...overrides });
    await trust({ numerator: 9n, denominator: 10n, detail: { multiCaptured: 0, partialRefunds: 1 } });
    expect(await sqlState(trust())).toBe("23505");
    expect(await sqlState(trust({ signalId: "t1_recipe_coverage", grade: "OK" }))).toBe("23514");
    expect(await sqlState(trust({ signalId: "t1_recipe_coverage", numerator: -1n }))).toBe("23514");
    expect(await sqlState(trust({ signalId: "t1_recipe_coverage", detail: { customer: "9876543210" } as never }))).toBe("23514");
    expect(await sqlState(trust({ signalId: "t1_recipe_coverage", detail: { nested: { n: 1 } } as never }))).toBe("23514");
    await trust({ signalId: "t3_stock_count_recency", grade: "UNKNOWN" });
  });

  it("deleting the org removes its facts and trust rows", async () => {
    const doomed = await createTestOrg();
    await db().insert(iqDailyFacts).values(fact(doomed));
    await db().insert(iqDailyTrust).values({ orgId: doomed.orgId, businessDate: "2026-09-01", signalId: "t4_waste_logging", grade: "LOW", definitionVersion: 1 });
    await deleteTestOrg(doomed.orgId);
    const [facts] = await db().select({ n: sql<number>`count(*)::int` }).from(iqDailyFacts).where(eq(iqDailyFacts.orgId, doomed.orgId));
    const [trust] = await db().select({ n: sql<number>`count(*)::int` }).from(iqDailyTrust).where(eq(iqDailyTrust.orgId, doomed.orgId));
    expect([facts?.n, trust?.n]).toEqual([0, 0]);
  });
});

describe("0036 — read-path indexes (P1, P4)", () => {
  it("exist with the columns and predicate the design names", async () => {
    const rows = await db().execute<{ indexname: string; indexdef: string }>(sql`
      SELECT indexname, indexdef FROM pg_indexes
      WHERE schemaname = 'public'
        AND indexname IN ('orders_org_created_idx', 'payments_order_captured_idx', 'inventory_movements_org_type_occurred_idx')
      ORDER BY indexname
    `);
    expect(rows.map((r) => r.indexname)).toEqual([
      "inventory_movements_org_type_occurred_idx",
      "orders_org_created_idx",
      "payments_order_captured_idx",
    ]);
    const byName = Object.fromEntries(rows.map((r) => [r.indexname, r.indexdef]));
    expect(byName.orders_org_created_idx).toContain("(org_id, created_at)");
    expect(byName.inventory_movements_org_type_occurred_idx).toContain("(org_id, type, occurred_at)");
    expect(byName.payments_order_captured_idx).toContain("(order_id)");
    expect(byName.payments_order_captured_idx).toMatch(/CAPTURED.*PARTIALLY_REFUNDED/);
  });
});
