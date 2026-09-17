/**
 * 0038_iq_insights_copy_trust against the real local Supabase stack.
 *
 * - The new columns' CHECKs: copy shape, trust detail per state,
 *   status_reason tied to status, recon/sig keys tied to producers, and
 *   as_of NOT NULL with no default (RELIABILITY U2).
 * - The freeze trigger now covers copy, while trust, as_of and status_reason
 *   stay writable on a referenced insight.
 * - The read policy: recon.* and sig.* findings reach OWNER and MANAGER
 *   through PostgREST; ADMIN sees every other insight; CASHIER and ANALYST
 *   see none (R2.2).
 */
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/db";
import { iqInsights, iqRecommendations, memberships } from "@/db/schema";
import { createTestOrg, deleteTestOrg, type TestOrg } from "./__test-support__/fixtures";

const HASH = "a".repeat(64);
const HOUR = 3600_000;

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
    throw new Error("iq-insights-0038: NEXT_PUBLIC_SUPABASE_URL is not the local `supabase start` API. Refusing to run.");
  }
  if (!anonKey || !serviceKey) throw new Error("iq-insights-0038: local anon/service keys missing from .env.test.local.");
  return { url, anonKey, serviceKey };
}

const noSession = { auth: { persistSession: false, autoRefreshToken: false } } as const;

type InsightRow = typeof iqInsights.$inferInsert;

function insight(org: TestOrg, overrides: Partial<InsightRow> = {}): InsightRow {
  const now = new Date();
  return {
    orgId: org.orgId,
    claimType: "DETECTION",
    producer: "detect.food_cost",
    subjectKind: "METRIC",
    subjectRef: "food_cost_pct",
    periodStart: new Date(now.getTime() - 24 * HOUR),
    periodEnd: now,
    asOf: now,
    dedupeKey: `detect:${randomUUID()}`,
    payload: { ruleId: "test_rule" },
    evidence: [{ kind: "metric", metricId: "food_cost_pct" }],
    codeVersion: "abc1234",
    contentHash: HASH,
    ...overrides,
  };
}

async function insert(values: InsightRow): Promise<string> {
  const [row] = await db().insert(iqInsights).values(values).returning({ id: iqInsights.id });
  if (!row) throw new Error("iq-insights-0038: insert returned no row");
  return row.id;
}

describe("0038 — column CHECKs", () => {
  let org: TestOrg;

  beforeAll(async () => {
    org = await createTestOrg();
  });

  afterAll(async () => {
    if (org) await deleteTestOrg(org.orgId);
  });

  it("as_of is NOT NULL and has no default", async () => {
    const [column] = await db().execute<{ column_default: string | null; is_nullable: string }>(sql`
      SELECT column_default, is_nullable FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'iq_insights' AND column_name = 'as_of'
    `);
    expect(column).toEqual({ column_default: null, is_nullable: "NO" });
    const { asOf: _omitted, ...withoutAsOf } = insight(org);
    void _omitted;
    expect(await sqlState(db().insert(iqInsights).values(withoutAsOf as InsightRow))).toBe("23502");
  });

  it("copy defaults to the placeholder and must be exactly { templateId, slots } with valid names and paths", async () => {
    const id = await insert(insight(org));
    const [row] = await db().select({ copy: iqInsights.copy }).from(iqInsights).where(eq(iqInsights.id, id));
    expect(row?.copy).toEqual({ templateId: "none", slots: {} });

    await insert(insight(org, { copy: { templateId: "detect.food_cost.v1", slots: { observed: "observed", base: "baseline.value" } } }));
    const bad: unknown[] = [
      { templateId: "t", slots: {}, extra: 1 },
      { templateId: "Detect", slots: {} },
      { templateId: "t" },
      { templateId: "t", slots: { observed: 5 } },
      { templateId: "t", slots: { observed: "a..b" } },
      { templateId: "t", slots: { Observed: "value" } },
      ["t"],
    ];
    for (const copy of bad) {
      expect([copy, await sqlState(insert(insight(org, { copy: copy as InsightRow["copy"] })))]).toEqual([copy, "23514"]);
    }
  });

  it("trust detail follows the state: MEASURED ≥1 metric id, INSUFFICIENT_DATA ≥1 reason, NOT_MEASURED neither", async () => {
    const measured = { trustState: "MEASURED", trustScore: 80, trustAsOf: new Date() } as const;
    await insert(insight(org, { ...measured, trustMetricIds: ["revenue_net"], trustReasons: [] }));
    await insert(insight(org, { ...measured, trustMetricIds: ["revenue_net", "food_cost_theoretical"], trustReasons: ["LOW_VOLUME"] }));
    await insert(insight(org, { trustState: "INSUFFICIENT_DATA", trustReasons: ["NO_HISTORY"] }));
    await insert(insight(org));

    const refused: Partial<InsightRow>[] = [
      { ...measured, trustMetricIds: [] },
      { trustState: "INSUFFICIENT_DATA", trustReasons: [] },
      { trustState: "INSUFFICIENT_DATA", trustReasons: ["NO_HISTORY"], trustMetricIds: ["revenue_net"] },
      { trustMetricIds: ["revenue_net"] },
      { trustReasons: ["LOW_VOLUME"] },
      { ...measured, trustMetricIds: ["Revenue Net"] },
      { ...measured, trustMetricIds: ["revenue_net"], trustReasons: ["low volume"] },
      { ...measured, trustMetricIds: ["a,b"] },
      { ...measured, trustMetricIds: ["revenue_net", ""] },
      { ...measured, trustMetricIds: [""] },
      { trustState: "INSUFFICIENT_DATA", trustReasons: ["NO_HISTORY,LOW_VOLUME"] },
    ];
    for (const overrides of refused) {
      expect([overrides, await sqlState(insert(insight(org, overrides)))]).toEqual([overrides, "23514"]);
    }
  });

  it("status_reason is null while ACTIVE and names the status it explains", async () => {
    await insert(insight(org, { status: "EXPIRED", statusReason: "CLEARED" }));
    await insert(insight(org, { status: "EXPIRED", statusReason: "CLOSING_TIME" }));
    await insert(insight(org, { status: "RETRACTED", statusReason: "RETRACTED" }));
    await insert(insight(org, { status: "EXPIRED" }));
    for (const overrides of [
      { status: "ACTIVE", statusReason: "CLEARED" },
      { status: "EXPIRED", statusReason: "SUPERSEDED" },
      { status: "RETRACTED", statusReason: "CLEARED" },
      { status: "EXPIRED", statusReason: "RECOVERED" },
    ] as const) {
      expect([overrides, await sqlState(insert(insight(org, overrides)))]).toEqual([overrides, "23514"]);
    }
  });

  it("recon: and sig: dedupe keys belong to recon. and sig. producers, and only to them", async () => {
    await insert(insight(org, { producer: "recon.cash_gap", dedupeKey: `recon:cash_gap:${randomUUID()}` }));
    await insert(insight(org, { producer: "sig.double_capture", dedupeKey: `sig:double_capture:${randomUUID()}` }));
    for (const overrides of [
      { producer: "detect.food_cost", dedupeKey: `recon:x:${randomUUID()}` },
      { producer: "recon.cash_gap", dedupeKey: `detect:x:${randomUUID()}` },
      { producer: "sig.double_capture", dedupeKey: `recon:x:${randomUUID()}` },
      { producer: "detect.food_cost", dedupeKey: `sig:x:${randomUUID()}` },
    ]) {
      expect([overrides.producer, await sqlState(insert(insight(org, overrides)))]).toEqual([overrides.producer, "23514"]);
    }
  });
});

describe("0038 — freeze covers copy; trust and as_of stay writable", () => {
  let org: TestOrg;

  beforeAll(async () => {
    org = await createTestOrg();
  });

  afterAll(async () => {
    if (org) await deleteTestOrg(org.orgId);
  });

  it("a referenced insight refuses a copy change and accepts trust, as_of and status_reason changes", async () => {
    const recInsightId = await insert(
      insight(org, {
        claimType: "RECOMMENDATION",
        producer: "detect.food_cost",
        payload: { actionKind: "inventory.flag_recount", evidenceInsightIds: [] },
        expiresAt: new Date(Date.now() + 24 * HOUR),
        copy: { templateId: "rec.v1", slots: {} },
      }),
    );
    await db().insert(iqRecommendations).values({
      orgId: org.orgId,
      insightId: recInsightId,
      actionKind: "inventory.flag_recount",
      tier: "A1",
      paramsHash: HASH,
      impactUnit: "paise",
      impactLow: 1n,
      impactHigh: 2n,
      confidence: "LOW",
      assumptions: [{ code: "TEST" }],
      expiresAt: new Date(Date.now() + 24 * HOUR),
      dedupeKey: `rec:${randomUUID()}`,
    });
    const where = eq(iqInsights.id, recInsightId);

    expect(await sqlState(db().update(iqInsights).set({ copy: { templateId: "rec.v2", slots: {} } }).where(where))).toBe("55000");

    const later = new Date(Date.now() + HOUR);
    await db()
      .update(iqInsights)
      .set({ trustState: "MEASURED", trustScore: 90, trustAsOf: later, trustMetricIds: ["revenue_net"], asOf: later })
      .where(where);
    await db().update(iqInsights).set({ status: "EXPIRED", statusReason: "CLEARED" }).where(where);
    const [row] = await db()
      .select({ trustState: iqInsights.trustState, asOf: iqInsights.asOf, statusReason: iqInsights.statusReason })
      .from(iqInsights)
      .where(where);
    expect(row).toEqual({ trustState: "MEASURED", asOf: later, statusReason: "CLEARED" });
  });
});

describe("0038 — who reads which insights through PostgREST (R2.2)", () => {
  let admin: SupabaseClient;
  const sessions = new Map<string, SupabaseClient>();
  const userIds: string[] = [];
  let org: TestOrg;
  let otherOrg: TestOrg;
  const ids = { plain: "", recon: "", sig: "" };

  beforeAll(async () => {
    const { url, anonKey, serviceKey } = localSupabaseEnv();
    admin = createClient(url, serviceKey, noSession);
    org = await createTestOrg();
    otherOrg = await createTestOrg();
    ids.plain = await insert(insight(org));
    ids.recon = await insert(insight(org, { producer: "recon.cash_gap", dedupeKey: `recon:cash_gap:${randomUUID()}` }));
    ids.sig = await insert(insight(org, { producer: "sig.double_capture", dedupeKey: `sig:double_capture:${randomUUID()}` }));
    await insert(insight(otherOrg));
    await insert(insight(otherOrg, { producer: "recon.cash_gap", dedupeKey: `recon:cash_gap:${randomUUID()}` }));

    const password = `pw-${randomUUID()}`;
    const suffix = randomUUID().slice(0, 8);
    for (const role of ["OWNER", "MANAGER", "ADMIN", "CASHIER", "ANALYST"] as const) {
      const email = `${role.toLowerCase()}-${suffix}@iq-insights-0038.test`;
      const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
      if (error || !data.user) throw new Error(`iq-insights-0038: createUser failed: ${error?.message}`);
      userIds.push(data.user.id);
      await db().insert(memberships).values({ orgId: org.orgId, userId: data.user.id, role });
      const client = createClient(url, anonKey, noSession);
      const signedIn = await client.auth.signInWithPassword({ email, password });
      if (signedIn.error) throw new Error(`iq-insights-0038: sign-in failed: ${signedIn.error.message}`);
      sessions.set(role, client);
    }
  });

  afterAll(async () => {
    for (const client of sessions.values()) await client.auth.signOut();
    if (org) await deleteTestOrg(org.orgId);
    if (otherOrg) await deleteTestOrg(otherOrg.orgId);
    for (const id of userIds) await admin.auth.admin.deleteUser(id);
  });

  const visible = async (role: string) => {
    const { data, error } = await sessions.get(role)!.from("iq_insights").select("id");
    expect(error).toBeNull();
    return (data ?? []).map((r: { id: string }) => r.id).sort();
  };

  it("OWNER and MANAGER read their own org's insights, payment-ledger findings included", async () => {
    for (const role of ["OWNER", "MANAGER"]) {
      expect([role, await visible(role)]).toEqual([role, [ids.plain, ids.recon, ids.sig].sort()]);
    }
  });

  it("ADMIN reads every insight except recon. and sig. findings", async () => {
    expect(await visible("ADMIN")).toEqual([ids.plain]);
  });

  it("CASHIER and ANALYST read no insights", async () => {
    for (const role of ["CASHIER", "ANALYST"]) expect([role, await visible(role)]).toEqual([role, []]);
  });

  it("the policy text is the one R2.2 specifies", async () => {
    const [policy] = await db().execute<{ cmd: string; roles: string[]; qual: string }>(sql`
      SELECT cmd, roles::text[] AS roles, qual FROM pg_policies
      WHERE schemaname = 'public' AND tablename = 'iq_insights' AND policyname = 'iq_insights_staff_read'
    `);
    expect(policy?.cmd).toBe("SELECT");
    expect(policy?.roles).toEqual(["authenticated"]);
    expect(policy?.qual).toMatch(/OWNER.*MANAGER.*OR.*ADMIN.*recon\.%.*sig\.%/s);
  });
});
