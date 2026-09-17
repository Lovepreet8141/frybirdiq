/**
 * 0034_iq_foundations against the real local Supabase stack.
 *
 * Four things the migration promises and nothing in TypeScript can prove:
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
 * 4. The action lifecycle as automation/state-machine.ts has it (mode derived
 *    from tier + auto policy): one open action per kind and params (C1),
 *    database-time decided_at/started_at (C6), execute-by on APPROVED and the
 *    APPROVED/HANDOFF exits (B4), approval XOR policy.
 */
import { createHash, randomUUID } from "node:crypto";
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
const randomHash = () => createHash("sha256").update(randomUUID()).digest("hex");
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
      CROSS JOIN unnest(ARRAY[
        'public.iq_insights_freeze_referenced()',
        'public.iq_insights_keep_referenced()',
        'public.iq_recommendations_reference_insights()',
        'public.iq_actions_stamp_status()'
      ]) AS f(fn)
    `);
    expect(rows.map((r) => r.granted)).toEqual(Array(8).fill(false));
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

  it("a referenced insight cannot be deleted — neither the recommendation's own nor its evidence", async () => {
    const evidenceId = await insertInsight(org);
    const recInsightId = await insertRecommendationInsight(org, [evidenceId]);
    await db().insert(iqRecommendations).values(recommendationValues(org, recInsightId));
    expect(await sqlState(db().delete(iqInsights).where(eq(iqInsights.id, recInsightId)))).toBe("55000");
    expect(await sqlState(db().delete(iqInsights).where(eq(iqInsights.id, evidenceId)))).toBe("55000");
    // An unreferenced one still can be pruned.
    const loose = await insertInsight(org);
    await db().delete(iqInsights).where(eq(iqInsights.id, loose));
  });

  it("evidence ids are matched as uuids, whatever their letter case", async () => {
    const evidenceId = await insertInsight(org);
    const recInsightId = await insertRecommendationInsight(org, [evidenceId.toUpperCase()]);
    await db().insert(iqRecommendations).values(recommendationValues(org, recInsightId));
    expect(await referencedAt(evidenceId)).not.toBeNull();
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
      status: "PENDING_APPROVAL",
      paramsHash: randomHash(),
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

  const handoff = { actionKind: "price.change", tier: "A3", status: "HANDOFF" } as const;
  const approvedA2 = { tier: "A2", actionKind: "menu.mark_86", approvedBy: randomUUID(), approvedAt: new Date() } as const;

  async function insertPolicy(actionKind: string): Promise<string> {
    const [row] = await db()
      .insert(iqAutoPolicies)
      .values({ orgId: org.orgId, actionKind, limits: { maxPerDay: 2 }, setBy: randomUUID(), reason: "test" })
      .returning({ id: iqAutoPolicies.id });
    return row!.id;
  }

  it("a money action kind can only be stored as an A3 handoff, and a handoff never executes", async () => {
    expect(await sqlState(db().insert(iqActions).values(action({ actionKind: "price.change", tier: "A2" })))).toBe("23514");
    expect(await sqlState(db().insert(iqActions).values(action({ actionKind: "refund.create", tier: "A1" })))).toBe("23514");
    expect(await sqlState(db().insert(iqActions).values(action({ actionKind: "menu.mark_86", tier: "A1" })))).toBe("23514");
    await db().insert(iqActions).values(action(handoff));
    for (const status of ["EXECUTING", "APPROVED", "QUEUED", "SUCCEEDED"] as const) {
      expect([status, await sqlState(db().insert(iqActions).values(action({ ...handoff, status, executeBy: new Date() })))]).toEqual([status, "23514"]);
    }
  });

  it("each mode holds only its own statuses: A0 never waits for approval, A2 never queues", async () => {
    const a0 = { actionKind: "brief.publish", tier: "A0", approvalExpiresAt: null } as const;
    await db().insert(iqActions).values(action({ ...a0, status: "QUEUED" }));
    expect(await sqlState(db().insert(iqActions).values(action({ ...a0, status: "PENDING_APPROVAL" })))).toBe("23514");
    expect(await sqlState(db().insert(iqActions).values(action({ tier: "A2", actionKind: "menu.mark_86", status: "QUEUED" })))).toBe("23514");
    // A1 without a policy is APPROVAL mode: QUEUED is not one of its statuses.
    expect(await sqlState(db().insert(iqActions).values(action({ status: "QUEUED" })))).toBe("23514");
  });

  it("an approval-mode action cannot be on the execute path without a person's approval", async () => {
    for (const status of ["APPROVED", "EXECUTING", "SUCCEEDED", "FAILED"] as const) {
      const row = action({ tier: "A2", actionKind: "menu.mark_86", status, executeBy: new Date(Date.now() + HOUR) });
      expect([status, await sqlState(db().insert(iqActions).values(row))]).toEqual([status, "23514"]);
    }
    await db()
      .insert(iqActions)
      .values(action({ ...approvedA2, status: "APPROVED", executeBy: new Date(Date.now() + HOUR) }));
  });

  it("approval-mode and handoff rows need approval_expires_at", async () => {
    expect(await sqlState(db().insert(iqActions).values(action({ approvalExpiresAt: null })))).toBe("23514");
    expect(await sqlState(db().insert(iqActions).values(action({ ...handoff, approvalExpiresAt: null })))).toBe("23514");
  });

  it("an auto policy only on A1; an A1 under a policy is AUTO and carries no person's approval", async () => {
    const policyId = await insertPolicy("task.open_internal");
    const auto = { actionKind: "task.open_internal", status: "QUEUED", approvalExpiresAt: null, autoPolicyId: policyId, autoPolicyVersion: 1 } as const;
    await db().insert(iqActions).values(action(auto));
    // Version without id, or id without version.
    expect(await sqlState(db().insert(iqActions).values(action({ ...auto, autoPolicyVersion: null })))).toBe("23514");
    // Approved by a person XOR run under a policy.
    expect(
      await sqlState(db().insert(iqActions).values(action({ ...auto, status: "EXECUTING", approvedBy: randomUUID(), approvedAt: new Date() }))),
    ).toBe("23514");
    // A policy on an A0 or A2 row is ROW_INCONSISTENT in modeOf.
    expect(await sqlState(db().insert(iqActions).values(action({ ...auto, actionKind: "brief.publish", tier: "A0" })))).toBe("23514");
    // The policy must belong to the same org.
    const stranger = await createTestOrg();
    try {
      expect(await sqlState(db().insert(iqActions).values({ ...action(auto), orgId: stranger.orgId }))).toBe("23503");
    } finally {
      await deleteTestOrg(stranger.orgId);
    }
  });

  it("only one open action per org, kind and params; a closed one does not block a new proposal (C1)", async () => {
    const paramsHash = randomHash();
    const [first] = await db().insert(iqActions).values(action({ paramsHash })).returning({ id: iqActions.id });
    expect(await sqlState(db().insert(iqActions).values(action({ paramsHash })))).toBe("23505");
    await db().update(iqActions).set({ status: "REJECTED" }).where(eq(iqActions.id, first!.id));
    await db().insert(iqActions).values(action({ paramsHash }));
  });

  it("decided_at and started_at are database time, set on the status change and never by the caller (C6)", async () => {
    const past = new Date("2020-01-01T00:00:00Z");
    const [dbNow] = await db().execute<{ t: string }>(sql`SELECT now()::text AS t`);
    const [row] = await db()
      .insert(iqActions)
      .values(action({ ...approvedA2, status: "APPROVED", executeBy: new Date(Date.now() + HOUR), decidedAt: past, startedAt: past }))
      .returning({ id: iqActions.id, decidedAt: iqActions.decidedAt, startedAt: iqActions.startedAt });
    expect([row!.decidedAt, row!.startedAt]).toEqual([null, null]);

    const read = async () =>
      (await db().select({ decidedAt: iqActions.decidedAt, startedAt: iqActions.startedAt }).from(iqActions).where(eq(iqActions.id, row!.id)))[0]!;

    await db().update(iqActions).set({ status: "EXECUTING" }).where(eq(iqActions.id, row!.id));
    const executing = await read();
    expect(executing.decidedAt).toBeNull();
    expect(executing.startedAt!.getTime()).toBeGreaterThanOrEqual(new Date(dbNow!.t).getTime());

    await db().update(iqActions).set({ errorCode: "noop", startedAt: past, decidedAt: past }).where(eq(iqActions.id, row!.id));
    expect(await read()).toEqual(executing);

    await db().update(iqActions).set({ status: "SUCCEEDED" }).where(eq(iqActions.id, row!.id));
    const done = await read();
    expect(done.decidedAt!.getTime()).toBeGreaterThanOrEqual(new Date(dbNow!.t).getTime());
    expect(done.startedAt).toEqual(executing.startedAt);
  });

  it("APPROVED needs an execute-by; APPROVED can expire or be cancelled; HANDOFF can expire or be superseded (B4)", async () => {
    expect(await sqlState(db().insert(iqActions).values(action({ ...approvedA2, status: "APPROVED" })))).toBe("23514");
    for (const to of ["EXPIRED", "CANCELLED"] as const) {
      const [row] = await db()
        .insert(iqActions)
        .values(action({ ...approvedA2, status: "APPROVED", executeBy: new Date(Date.now() + HOUR) }))
        .returning({ id: iqActions.id });
      await db().update(iqActions).set({ status: to }).where(eq(iqActions.id, row!.id));
    }
    for (const to of ["EXPIRED", "SUPERSEDED", "CANCELLED"] as const) {
      const [row] = await db().insert(iqActions).values(action(handoff)).returning({ id: iqActions.id });
      await db().update(iqActions).set({ status: to }).where(eq(iqActions.id, row!.id));
    }
  });

  it("job runs count failures from 0 and never below (0035)", async () => {
    const run = (failures?: number) =>
      db()
        .insert(iqJobRuns)
        .values({
          orgId: org.orgId,
          job: "heartbeat",
          periodKey: `2026-09-17T${randomUUID().slice(0, 8)}`,
          trigger: "TIMER",
          leaseOwner: randomUUID(),
          leaseExpiresAt: new Date(Date.now() + 300_000),
          deadlineAt: new Date(Date.now() + 240_000),
          codeVersion: "abc1234",
          ...(failures === undefined ? {} : { failures }),
        })
        .returning({ failures: iqJobRuns.failures });
    expect((await run())[0]!.failures).toBe(0);
    expect(await sqlState(run(-1))).toBe("23514");
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
