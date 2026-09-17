/**
 * 0034_iq_foundations against the real local Supabase stack.
 *
 * Three things the migration promises and nothing in TypeScript can prove:
 *
 * 1. Grants and RLS. anon and authenticated hold no privilege on any iq_*
 *    table except SELECT on iq_insights, iq_recommendations and iq_actions,
 *    which RLS narrows to OWNER, ADMIN and MANAGER of the row's org. Checked
 *    as a has_table_privilege matrix and again through PostgREST with real
 *    staff sessions.
 * 2. A referenced insight is frozen. Inserting a recommendation marks its
 *    own insight and its evidence insights (same org only) as referenced;
 *    after that their content cannot change, only be superseded.
 * 3. The CHECK backstops: no bare `value` on a FORECAST, no executable money
 *    kind, no approval-mode execution without a person's approval, strict
 *    auto-policy limits, and an org delete that still cascades through all of it.
 */
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/db";
import {
  iqActions,
  iqAutoPolicies,
  iqForecasts,
  iqInsights,
  iqJobRuns,
  iqOutcomes,
  iqRecommendations,
  memberships,
} from "@/db/schema";
import { createTestOrg, deleteTestOrg, type TestOrg } from "./__test-support__/fixtures";

const IQ_TABLES = [
  "iq_job_runs",
  "iq_insights",
  "iq_forecasts",
  "iq_recommendations",
  "iq_actions",
  "iq_outcomes",
  "iq_auto_policies",
] as const;
const STAFF_READABLE = new Set(["iq_insights", "iq_recommendations", "iq_actions"]);
const PRIVILEGES = ["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER"] as const;

const HASH = "a".repeat(64);
const HOUR = 3600_000;

/** Postgres SQLSTATE from a failed Drizzle query (drizzle wraps the driver error in `cause`). */
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
    throw new Error("iq-foundations: NEXT_PUBLIC_SUPABASE_URL is not the local `supabase start` API. Refusing to run.");
  }
  if (!anonKey || !serviceKey) throw new Error("iq-foundations: local anon/service keys missing from .env.test.local.");
  return { url, anonKey, serviceKey };
}

const noSession = { auth: { persistSession: false, autoRefreshToken: false } } as const;

type InsightOverrides = Partial<typeof iqInsights.$inferInsert>;

async function insertInsight(org: TestOrg, overrides: InsightOverrides = {}): Promise<string> {
  const now = new Date();
  const [row] = await db()
    .insert(iqInsights)
    .values({
      orgId: org.orgId,
      locationId: org.locationId,
      claimType: "DETECTION",
      producer: "test",
      subjectKind: "METRIC",
      subjectRef: "food_cost_pct",
      periodStart: new Date(now.getTime() - HOUR),
      periodEnd: now,
      dedupeKey: `test:${randomUUID()}`,
      payload: { ruleId: "test_rule" },
      evidence: [{ kind: "metric", metricId: "food_cost_pct" }],
      codeVersion: "abc1234",
      contentHash: HASH,
      ...overrides,
    })
    .returning({ id: iqInsights.id });
  if (!row) throw new Error("iq-foundations: insight insert returned no row");
  return row.id;
}

async function insertRecommendationInsight(org: TestOrg, evidenceInsightIds: string[]): Promise<string> {
  return insertInsight(org, {
    claimType: "RECOMMENDATION",
    payload: { actionKind: "inventory.flag_recount", evidenceInsightIds },
    expiresAt: new Date(Date.now() + 24 * HOUR),
  });
}

function recommendationValues(org: TestOrg, insightId: string): typeof iqRecommendations.$inferInsert {
  return {
    orgId: org.orgId,
    locationId: org.locationId,
    insightId,
    actionKind: "inventory.flag_recount",
    tier: "A1",
    paramsHash: HASH,
    impactUnit: "paise",
    impactLow: 1000n,
    impactHigh: 5000n,
    confidence: "LOW",
    assumptions: [{ code: "test" }],
    expiresAt: new Date(Date.now() + 24 * HOUR),
    dedupeKey: `rec:${randomUUID()}`,
  };
}

async function referencedAt(id: string): Promise<Date | null> {
  const [row] = await db().select({ referencedAt: iqInsights.referencedAt }).from(iqInsights).where(eq(iqInsights.id, id));
  return row?.referencedAt ?? null;
}

describe("0034 — grants and row-level security", () => {
  it("anon and authenticated hold no privilege on iq_* except authenticated SELECT on the three staff tables", async () => {
    const rows = await db().execute<{ table_name: string; role: string; privilege: string; granted: boolean }>(sql`
      SELECT t.table_name, r.role, p.privilege,
             has_table_privilege(r.role, format('public.%I', t.table_name), p.privilege) AS granted
      FROM unnest(${sql.raw(`ARRAY[${IQ_TABLES.map((t) => `'${t}'`).join(", ")}]`)}::text[]) AS t(table_name)
      CROSS JOIN unnest(ARRAY['anon', 'authenticated']) AS r(role)
      CROSS JOIN unnest(${sql.raw(`ARRAY[${PRIVILEGES.map((p) => `'${p}'`).join(", ")}]`)}::text[]) AS p(privilege)
    `);
    expect(rows.length).toBe(IQ_TABLES.length * 2 * PRIVILEGES.length);
    for (const row of rows) {
      const expected = row.role === "authenticated" && row.privilege === "SELECT" && STAFF_READABLE.has(row.table_name);
      expect({ ...row, granted: row.granted }).toEqual({ ...row, granted: expected });
    }
  });

  it("RLS is enabled and forced on every iq_* table, with only the three staff SELECT policies", async () => {
    const tables = await db().execute<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>(sql`
      SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class
      WHERE relnamespace = 'public'::regnamespace AND relkind = 'r' AND relname LIKE 'iq\\_%'
      ORDER BY relname
    `);
    expect(tables.map((t) => t.relname)).toEqual([...IQ_TABLES].sort());
    for (const t of tables) expect([t.relname, t.relrowsecurity, t.relforcerowsecurity]).toEqual([t.relname, true, true]);

    const policies = await db().execute<{ tablename: string; policyname: string; cmd: string; roles: string[] }>(sql`
      SELECT tablename, policyname, cmd, roles::text[] AS roles FROM pg_policies
      WHERE schemaname = 'public' AND tablename LIKE 'iq\\_%' ORDER BY tablename
    `);
    expect(policies.map((p) => [p.tablename, p.policyname, p.cmd, p.roles])).toEqual([
      ["iq_actions", "iq_actions_staff_read", "SELECT", ["authenticated"]],
      ["iq_insights", "iq_insights_staff_read", "SELECT", ["authenticated"]],
      ["iq_recommendations", "iq_recommendations_staff_read", "SELECT", ["authenticated"]],
    ]);
  });

  it("the trigger functions are not executable by anon or authenticated", async () => {
    const rows = await db().execute<{ granted: boolean }>(sql`
      SELECT has_function_privilege(r.role, f.fn, 'EXECUTE') AS granted
      FROM unnest(ARRAY['anon', 'authenticated']) AS r(role)
      CROSS JOIN unnest(ARRAY['public.iq_insights_freeze_referenced()', 'public.iq_recommendations_reference_insights()']) AS f(fn)
    `);
    expect(rows.map((r) => r.granted)).toEqual([false, false, false, false]);
  });
});

describe("0034 — what staff sessions can read through PostgREST", () => {
  let admin: SupabaseClient;
  let manager: SupabaseClient;
  let cashier: SupabaseClient;
  let org: TestOrg;
  let otherOrg: TestOrg;
  const userIds: string[] = [];
  let ownInsightId: string;

  beforeAll(async () => {
    const { url, anonKey, serviceKey } = localSupabaseEnv();
    admin = createClient(url, serviceKey, noSession);
    org = await createTestOrg();
    otherOrg = await createTestOrg();
    ownInsightId = await insertInsight(org);
    await insertInsight(otherOrg);

    const password = `pw-${randomUUID()}`;
    const suffix = randomUUID().slice(0, 8);
    const signIn = async (role: "MANAGER" | "CASHIER") => {
      const email = `${role.toLowerCase()}-${suffix}@iq-foundations.test`;
      const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
      if (error || !data.user) throw new Error(`iq-foundations: createUser failed: ${error?.message}`);
      userIds.push(data.user.id);
      await db().insert(memberships).values({ orgId: org.orgId, userId: data.user.id, role });
      const client = createClient(url, anonKey, noSession);
      const signedIn = await client.auth.signInWithPassword({ email, password });
      if (signedIn.error) throw new Error(`iq-foundations: sign-in failed: ${signedIn.error.message}`);
      return client;
    };
    manager = await signIn("MANAGER");
    cashier = await signIn("CASHIER");
  });

  afterAll(async () => {
    await manager?.auth.signOut();
    await cashier?.auth.signOut();
    if (org) await deleteTestOrg(org.orgId);
    if (otherOrg) await deleteTestOrg(otherOrg.orgId);
    for (const id of userIds) await admin.auth.admin.deleteUser(id);
  });

  it("a manager reads their own org's insights and never another org's", async () => {
    const { data, error } = await manager.from("iq_insights").select("id, org_id");
    expect(error).toBeNull();
    expect(data).toEqual([{ id: ownInsightId, org_id: org.orgId }]);
  });

  it("a cashier reads no insights", async () => {
    const { data, error } = await cashier.from("iq_insights").select("id");
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("a manager cannot write insights, and cannot read the server-only tables", async () => {
    const write = await manager.from("iq_insights").update({ status: "RETRACTED" }).eq("id", ownInsightId);
    expect(write.error?.code).toBe("42501");
    for (const table of ["iq_job_runs", "iq_forecasts", "iq_outcomes", "iq_auto_policies"]) {
      const read = await manager.from(table).select("id");
      expect([table, read.error?.code]).toEqual([table, "42501"]);
    }
  });

  it("the bare anon key reads nothing", async () => {
    const { url, anonKey } = localSupabaseEnv();
    const anon = createClient(url, anonKey, noSession);
    const read = await anon.from("iq_insights").select("id");
    expect(read.error?.code).toBe("42501");
  });
});

describe("0034 — referenced insights are frozen", () => {
  let org: TestOrg;
  let otherOrg: TestOrg;

  beforeAll(async () => {
    org = await createTestOrg();
    otherOrg = await createTestOrg();
  });

  afterAll(async () => {
    if (org) await deleteTestOrg(org.orgId);
    if (otherOrg) await deleteTestOrg(otherOrg.orgId);
  });

  it("an unreferenced insight can still be rewritten", async () => {
    const id = await insertInsight(org);
    await db().update(iqInsights).set({ payload: { ruleId: "rewritten" } }).where(eq(iqInsights.id, id));
    expect(await referencedAt(id)).toBeNull();
  });

  it("a recommendation freezes its own insight and its same-org evidence, and nothing in another org", async () => {
    const evidenceId = await insertInsight(org);
    const foreignId = await insertInsight(otherOrg);
    const recInsightId = await insertRecommendationInsight(org, [evidenceId, foreignId]);

    await db().insert(iqRecommendations).values(recommendationValues(org, recInsightId));

    expect(await referencedAt(recInsightId)).not.toBeNull();
    expect(await referencedAt(evidenceId)).not.toBeNull();
    expect(await referencedAt(foreignId)).toBeNull();

    for (const id of [recInsightId, evidenceId]) {
      expect(await sqlState(db().update(iqInsights).set({ payload: { ruleId: "tampered" } }).where(eq(iqInsights.id, id)))).toBe("55000");
      expect(await sqlState(db().update(iqInsights).set({ evidence: [{ kind: "query" }] }).where(eq(iqInsights.id, id)))).toBe("55000");
      expect(await sqlState(db().update(iqInsights).set({ contentHash: "b".repeat(64) }).where(eq(iqInsights.id, id)))).toBe("55000");
      expect(await sqlState(db().update(iqInsights).set({ dedupeKey: "moved" }).where(eq(iqInsights.id, id)))).toBe("55000");
      expect(await sqlState(db().update(iqInsights).set({ referencedAt: null }).where(eq(iqInsights.id, id)))).toBe("55000");
    }
    // The foreign insight was never frozen by someone else's recommendation.
    await db().update(iqInsights).set({ payload: { ruleId: "still-mine" } }).where(eq(iqInsights.id, foreignId));
  });

  it("a frozen insight can be superseded by a new row with the same dedupe key", async () => {
    const dedupeKey = `detect:${randomUUID()}`;
    const oldId = await insertInsight(org, { dedupeKey });
    await db().insert(iqRecommendations).values(recommendationValues(org, await insertRecommendationInsight(org, [oldId])));
    expect(await referencedAt(oldId)).not.toBeNull();

    const newId = randomUUID();
    await db().transaction(async (tx) => {
      // Old row first: superseded_by points at a row that does not exist until the insert below (deferred FK).
      await tx.update(iqInsights).set({ status: "SUPERSEDED", supersededBy: newId }).where(eq(iqInsights.id, oldId));
      await tx.insert(iqInsights).values({
        id: newId,
        orgId: org.orgId,
        claimType: "DETECTION",
        producer: "test",
        subjectKind: "METRIC",
        subjectRef: "food_cost_pct",
        periodStart: new Date(Date.now() - HOUR),
        periodEnd: new Date(),
        dedupeKey,
        payload: { ruleId: "revised" },
        evidence: [{ kind: "metric", metricId: "food_cost_pct" }],
        codeVersion: "abc1234",
        contentHash: "c".repeat(64),
        supersedes: oldId,
      });
    });
    const [old] = await db().select({ status: iqInsights.status, supersededBy: iqInsights.supersededBy }).from(iqInsights).where(eq(iqInsights.id, oldId));
    expect(old).toEqual({ status: "SUPERSEDED", supersededBy: newId });
  });

  it("a second ACTIVE insight with the same dedupe key is refused", async () => {
    const dedupeKey = `dup:${randomUUID()}`;
    await insertInsight(org, { dedupeKey });
    expect(await sqlState(insertInsight(org, { dedupeKey }))).toBe("23505");
  });

  it("a recommendation must cite a RECOMMENDATION insight of its own org", async () => {
    const detectionId = await insertInsight(org);
    expect(await sqlState(db().insert(iqRecommendations).values(recommendationValues(org, detectionId)))).toBe("23514");

    const foreignRecId = await insertRecommendationInsight(otherOrg, []);
    expect(await sqlState(db().insert(iqRecommendations).values(recommendationValues(org, foreignRecId)))).toBe("23503");
  });

  it("a cited insight cannot be deleted directly", async () => {
    const recInsightId = await insertRecommendationInsight(org, []);
    await db().insert(iqRecommendations).values(recommendationValues(org, recInsightId));
    expect(await sqlState(db().delete(iqInsights).where(eq(iqInsights.id, recInsightId)))).toBe("23503");
  });
});

describe("0034 — CHECK backstops and cascade", () => {
  let org: TestOrg;

  beforeAll(async () => {
    org = await createTestOrg();
  });

  afterAll(async () => {
    if (org) await deleteTestOrg(org.orgId);
  });

  function action(overrides: Partial<typeof iqActions.$inferInsert>): typeof iqActions.$inferInsert {
    return {
      orgId: org.orgId,
      actionKind: "inventory.flag_recount",
      tier: "A1",
      mode: "APPROVAL",
      status: "PENDING_APPROVAL",
      paramsHash: HASH,
      idempotencyKey: `act:${randomUUID()}`,
      origin: "test",
      approvalExpiresAt: new Date(Date.now() + HOUR),
      ...overrides,
    };
  }

  it("a FORECAST, RECOMMENDATION or EXPLANATION never stores a bare value; a FORECAST needs its interval", async () => {
    expect(await sqlState(insertInsight(org, { claimType: "FORECAST", payload: { value: 1, interval: {} } }))).toBe("23514");
    expect(await sqlState(insertInsight(org, { claimType: "FORECAST", payload: { modelId: "m" } }))).toBe("23514");
    expect(await sqlState(insertInsight(org, { claimType: "EXPLANATION", payload: { value: 1 } }))).toBe("23514");
    expect(
      await sqlState(insertInsight(org, { claimType: "RECOMMENDATION", payload: { value: 1 }, expiresAt: new Date() })),
    ).toBe("23514");
    expect(await sqlState(insertInsight(org, { claimType: "RECOMMENDATION", payload: {} }))).toBe("23514");
    await insertInsight(org, { claimType: "FACT", payload: { value: { unit: "count", value: 3 } } });
  });

  it("a money action kind can only be stored as A3 handoff", async () => {
    expect(await sqlState(db().insert(iqActions).values(action({ actionKind: "price.change", tier: "A2" })))).toBe("23514");
    expect(await sqlState(db().insert(iqActions).values(action({ actionKind: "refund.create", tier: "A1" })))).toBe("23514");
    expect(await sqlState(db().insert(iqActions).values(action({ actionKind: "menu.mark_86", tier: "A1" })))).toBe("23514");
    await db()
      .insert(iqActions)
      .values(action({ actionKind: "price.change", tier: "A3", mode: "HANDOFF", status: "HANDOFF", approvalExpiresAt: null }));
    expect(
      await sqlState(
        db().insert(iqActions).values(action({ actionKind: "price.change", tier: "A3", mode: "HANDOFF", status: "EXECUTING", approvalExpiresAt: null })),
      ),
    ).toBe("23514");
  });

  it("an approval-mode action cannot execute without a person's approval, and A2 never runs automatically", async () => {
    expect(await sqlState(db().insert(iqActions).values(action({ tier: "A2", actionKind: "menu.mark_86", status: "EXECUTING" })))).toBe("23514");
    expect(await sqlState(db().insert(iqActions).values(action({ tier: "A2", actionKind: "menu.mark_86", mode: "AUTO", status: "QUEUED" })))).toBe("23514");
    expect(await sqlState(db().insert(iqActions).values(action({ mode: "AUTO", status: "QUEUED", approvalExpiresAt: null })))).toBe("23514");
    await db()
      .insert(iqActions)
      .values(action({ tier: "A2", actionKind: "menu.mark_86", status: "APPROVED", approvedBy: randomUUID(), approvedAt: new Date() }));
  });

  it("auto policy limits are exactly { maxPerDay: 1..50 } and only A1 kinds get a policy", async () => {
    const policy = (limits: unknown, actionKind = "inventory.flag_recount") =>
      db().insert(iqAutoPolicies).values({
        orgId: org.orgId,
        actionKind,
        limits: limits as { maxPerDay: number },
        setBy: randomUUID(),
        reason: "test",
      });
    expect(await sqlState(policy({ maxPerDay: 51 }))).toBe("23514");
    expect(await sqlState(policy({ maxPerDay: 1.5 }))).toBe("23514");
    expect(await sqlState(policy({ maxPerDay: "5" }))).toBe("23514");
    expect(await sqlState(policy({ maxPerDay: 5, extra: true }))).toBe("23514");
    expect(await sqlState(policy({ maxPerDay: 5 }, "menu.mark_86"))).toBe("23514");
    await policy({ maxPerDay: 5 });
    // One policy per org, kind and location — an org-wide row (location null) included.
    expect(await sqlState(policy({ maxPerDay: 3 }))).toBe("23505");
  });

  it("an automatic A1 action names its policy version; the policy must belong to the same org", async () => {
    const [policy] = await db()
      .insert(iqAutoPolicies)
      .values({ orgId: org.orgId, actionKind: "task.open_internal", limits: { maxPerDay: 2 }, setBy: randomUUID(), reason: "test" })
      .returning({ id: iqAutoPolicies.id });
    expect(await sqlState(db().insert(iqActions).values(action({ actionKind: "task.open_internal", mode: "AUTO", status: "QUEUED", approvalExpiresAt: null })))).toBe(
      "23514",
    );
    await db()
      .insert(iqActions)
      .values(
        action({ actionKind: "task.open_internal", mode: "AUTO", status: "QUEUED", approvalExpiresAt: null, autoPolicyId: policy!.id, autoPolicyVersion: 1 }),
      );

    const stranger = await createTestOrg();
    try {
      expect(
        await sqlState(
          db()
            .insert(iqActions)
            .values({
              ...action({ actionKind: "task.open_internal", mode: "AUTO", status: "QUEUED", approvalExpiresAt: null, autoPolicyId: policy!.id, autoPolicyVersion: 1 }),
              orgId: stranger.orgId,
            }),
        ),
      ).toBe("23503");
    } finally {
      await deleteTestOrg(stranger.orgId);
    }
  });

  it("forecast intervals are ordered and non-negative", async () => {
    const forecast = (p10: bigint, p50: bigint, p90: bigint) =>
      db().insert(iqForecasts).values({
        orgId: org.orgId,
        targetKind: "ORDERS",
        targetRef: "all",
        businessDate: "2026-09-18",
        unit: "count",
        p10,
        p50,
        p90,
        modelId: "naive",
        modelVersion: `v-${randomUUID()}`,
        issuedFor: "2026-09-17",
        horizonDays: 1,
        backtestMetric: "WAPE",
        modelErrorBps: 1200,
        naiveErrorBps: 1500,
        backtestWindowDays: 28,
        backtestProvenance: "LOCAL_SYNTHETIC",
      });
    expect(await sqlState(forecast(5n, 4n, 6n))).toBe("23514");
    expect(await sqlState(forecast(-1n, 4n, 6n))).toBe("23514");
    await forecast(3n, 4n, 6n);
  });

  it("deleting an org cascades through job runs, insights, recommendations, actions, outcomes and policies", async () => {
    const doomed = await createTestOrg();
    const [run] = await db()
      .insert(iqJobRuns)
      .values({
        orgId: doomed.orgId,
        job: "heartbeat",
        periodKey: "2026-09-17T10",
        trigger: "TIMER",
        leaseOwner: randomUUID(),
        leaseExpiresAt: new Date(Date.now() + 300_000),
        deadlineAt: new Date(Date.now() + 240_000),
        codeVersion: "abc1234",
      })
      .returning({ id: iqJobRuns.id });
    const evidenceId = await insertInsight(doomed, { jobRunId: run!.id });
    const recInsightId = await insertRecommendationInsight(doomed, [evidenceId]);
    const [rec] = await db().insert(iqRecommendations).values(recommendationValues(doomed, recInsightId)).returning({ id: iqRecommendations.id });
    await db()
      .insert(iqActions)
      .values({ ...action({ recommendationId: rec!.id }), orgId: doomed.orgId });
    await db().insert(iqOutcomes).values({
      orgId: doomed.orgId,
      subjectKind: "RECOMMENDATION",
      subjectId: rec!.id,
      metricId: "food_cost_pct",
      windowStart: new Date(Date.now() - HOUR),
      windowEnd: new Date(),
      unit: "bps",
      expectedLow: 100n,
      expectedHigh: 200n,
      verdict: "DATA_MISSING",
    });
    await db().insert(iqAutoPolicies).values({ orgId: doomed.orgId, actionKind: "prep_list.prefill", limits: { maxPerDay: 1 }, setBy: randomUUID(), reason: "test" });

    await deleteTestOrg(doomed.orgId);

    for (const table of IQ_TABLES) {
      const [row] = await db().execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM ${sql.identifier(table)} WHERE org_id = ${doomed.orgId}`);
      expect([table, row?.n]).toEqual([table, 0]);
    }
  });
});
