/**
 * iq-actions.ts against the real local Supabase stack: approval and
 * rejection as one compare-and-set transaction with its audit row, the four
 * miss reasons, a double tap, two people deciding at once, and org isolation.
 */
import { createHash, randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/db";
import { auditLogs, iqActions, iqInsights, iqRecommendations } from "@/db/schema";
import { createTestOrg, deleteTestOrg, type TestOrg } from "./__test-support__/fixtures";
import { approveAction, rejectAction } from "./iq-actions";

const HOUR = 3600_000;
const hash = () => createHash("sha256").update(randomUUID()).digest("hex");
const ME = randomUUID();
const YOU = randomUUID();

let org: TestOrg;
let otherOrg: TestOrg;

beforeAll(async () => {
  org = await createTestOrg();
  otherOrg = await createTestOrg();
});

afterAll(async () => {
  await deleteTestOrg(org.orgId);
  await deleteTestOrg(otherOrg.orgId);
});

async function insertAction(target: TestOrg, overrides: Partial<typeof iqActions.$inferInsert> = {}) {
  const paramsHash = overrides.paramsHash ?? hash();
  const [row] = await db()
    .insert(iqActions)
    .values({
      orgId: target.orgId,
      locationId: target.locationId,
      actionKind: "menu.mark_86",
      tier: "A2",
      status: "PENDING_APPROVAL",
      paramsHash,
      idempotencyKey: `test:${randomUUID()}`,
      origin: "test",
      approvalExpiresAt: new Date(Date.now() + HOUR),
      ...overrides,
    })
    .returning({ id: iqActions.id });
  if (!row) throw new Error("insert returned no row");
  return { id: row.id, paramsHash };
}

async function insertRecommendation(target: TestOrg, paramsHash: string) {
  const now = new Date();
  const insight = async (claimType: "DETECTION" | "RECOMMENDATION", payload: Record<string, unknown>) => {
    const [row] = await db()
      .insert(iqInsights)
      .values({
        orgId: target.orgId,
        locationId: target.locationId,
        claimType,
        producer: "test",
        subjectKind: "METRIC",
        subjectRef: "stock",
        periodStart: new Date(now.getTime() - HOUR),
        periodEnd: now,
        asOf: now,
        dedupeKey: `test:${randomUUID()}`,
        payload,
        evidence: [{ kind: "metric", metricId: "stock" }],
        codeVersion: "abc1234",
        contentHash: "a".repeat(64),
        ...(claimType === "RECOMMENDATION" ? { expiresAt: new Date(now.getTime() + 24 * HOUR) } : {}),
      })
      .returning({ id: iqInsights.id });
    return row!.id;
  };
  const detection = await insight("DETECTION", { ruleId: "test_rule" });
  const recInsight = await insight("RECOMMENDATION", { actionKind: "menu.mark_86", evidenceInsightIds: [detection] });
  const [rec] = await db()
    .insert(iqRecommendations)
    .values({
      orgId: target.orgId,
      locationId: target.locationId,
      insightId: recInsight,
      actionKind: "menu.mark_86",
      tier: "A2",
      paramsHash,
      impactUnit: "paise",
      impactLow: 0n,
      impactHigh: 1000n,
      confidence: "LOW",
      assumptions: [{ code: "TEST" }],
      expiresAt: new Date(now.getTime() + 24 * HOUR),
      dedupeKey: `rec:${randomUUID()}`,
    })
    .returning({ id: iqRecommendations.id });
  return rec!.id;
}

const actionRow = async (id: string) => (await db().select().from(iqActions).where(eq(iqActions.id, id)))[0]!;
const auditFor = (id: string) => db().select().from(auditLogs).where(and(eq(auditLogs.orgId, org.orgId), eq(auditLogs.entityId, id)));

describe("approveAction", () => {
  it("approves in one transaction: status, approver, execute-by, recommendation and a linked audit row", async () => {
    const paramsHash = hash();
    const recommendationId = await insertRecommendation(org, paramsHash);
    const { id } = await insertAction(org, { paramsHash, recommendationId });

    expect(await approveAction({ orgId: org.orgId, actionId: id, userId: ME, paramsHash })).toEqual({ ok: true, repeated: false });

    const row = await actionRow(id);
    expect(row).toMatchObject({ status: "APPROVED", approvedBy: ME, decidedAt: null });
    const windowMs = row.executeBy!.getTime() - row.approvedAt!.getTime();
    expect(windowMs).toBe(3600_000);

    const [rec] = await db().select().from(iqRecommendations).where(eq(iqRecommendations.id, recommendationId));
    expect(rec).toMatchObject({ status: "APPROVED", decidedByUserId: ME });

    const audits = await auditFor(id);
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ action: "iq_action_approved", entity: "iq_actions", actorUserId: ME });
    expect(row.auditLogId).toBe(audits[0]!.id);
  });

  it("reports a double tap by the same person as success, without a second audit row", async () => {
    const { id, paramsHash } = await insertAction(org);
    await approveAction({ orgId: org.orgId, actionId: id, userId: ME, paramsHash });
    expect(await approveAction({ orgId: org.orgId, actionId: id, userId: ME, paramsHash })).toEqual({ ok: true, repeated: true });
    expect(await approveAction({ orgId: org.orgId, actionId: id, userId: YOU, paramsHash })).toEqual({
      ok: false,
      reason: "ALREADY_DECIDED",
    });
    expect(await auditFor(id)).toHaveLength(1);
  });

  it("lets exactly one of two people deciding at once win", async () => {
    const { id, paramsHash } = await insertAction(org);
    const results = await Promise.all([
      approveAction({ orgId: org.orgId, actionId: id, userId: ME, paramsHash }),
      rejectAction({ orgId: org.orgId, actionId: id, userId: YOU, paramsHash }),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok)).toEqual([{ ok: false, reason: "ALREADY_DECIDED" }]);
    expect(await auditFor(id)).toHaveLength(1);
  });

  it("refuses stale params and an expired request, changing nothing", async () => {
    const stale = await insertAction(org);
    expect(await approveAction({ orgId: org.orgId, actionId: stale.id, userId: ME, paramsHash: hash() })).toEqual({
      ok: false,
      reason: "STALE_PARAMS",
    });
    const expired = await insertAction(org, { approvalExpiresAt: new Date(Date.now() - 1000) });
    expect(await approveAction({ orgId: org.orgId, actionId: expired.id, userId: ME, paramsHash: expired.paramsHash })).toEqual({
      ok: false,
      reason: "EXPIRED",
    });
    for (const { id } of [stale, expired]) {
      expect((await actionRow(id)).status).toBe("PENDING_APPROVAL");
      expect(await auditFor(id)).toHaveLength(0);
    }
  });

  it("does not find another org's action, an A3 handoff, or an auto-policy row", async () => {
    const foreign = await insertAction(otherOrg);
    expect(await approveAction({ orgId: org.orgId, actionId: foreign.id, userId: ME, paramsHash: foreign.paramsHash })).toEqual({
      ok: false,
      reason: "NOT_FOUND",
    });
    expect((await actionRow(foreign.id)).status).toBe("PENDING_APPROVAL");

    const handoff = await insertAction(org, { actionKind: "price.change", tier: "A3", status: "HANDOFF" });
    expect(await approveAction({ orgId: org.orgId, actionId: handoff.id, userId: ME, paramsHash: handoff.paramsHash })).toEqual({
      ok: false,
      reason: "NOT_FOUND",
    });

    expect(await approveAction({ orgId: org.orgId, actionId: randomUUID(), userId: ME, paramsHash: hash() })).toEqual({
      ok: false,
      reason: "NOT_FOUND",
    });
    expect(await approveAction({ orgId: org.orgId, actionId: "not-a-uuid", userId: ME, paramsHash: hash() })).toEqual({
      ok: false,
      reason: "NOT_FOUND",
    });
  });
});

describe("rejectAction", () => {
  it("rejects with a database-time decided_at, dismisses the recommendation, and audits the reason", async () => {
    const paramsHash = hash();
    const recommendationId = await insertRecommendation(org, paramsHash);
    const { id } = await insertAction(org, { paramsHash, recommendationId });

    expect(await rejectAction({ orgId: org.orgId, actionId: id, userId: ME, paramsHash, reason: "Still in stock" })).toEqual({
      ok: true,
      repeated: false,
    });
    const row = await actionRow(id);
    expect(row).toMatchObject({ status: "REJECTED", decidedBy: ME, approvedBy: null });
    expect(row.decidedAt).toBeInstanceOf(Date);

    const [rec] = await db().select().from(iqRecommendations).where(eq(iqRecommendations.id, recommendationId));
    expect(rec).toMatchObject({ status: "DISMISSED", decisionReason: "Still in stock" });
    const audits = await auditFor(id);
    expect(audits[0]).toMatchObject({ action: "iq_action_rejected", after: expect.objectContaining({ reason: "Still in stock" }) });

    expect(await rejectAction({ orgId: org.orgId, actionId: id, userId: ME, paramsHash })).toEqual({ ok: true, repeated: true });
    expect(await approveAction({ orgId: org.orgId, actionId: id, userId: ME, paramsHash })).toEqual({
      ok: false,
      reason: "ALREADY_DECIDED",
    });
  });
});

describe("a decision needs its recommendation still PROPOSED (RELIABILITY M1 on cb92f9b)", () => {
  const closeRecommendation = (id: string, status: "SUPERSEDED" | "EXPIRED") =>
    db().update(iqRecommendations).set({ status, decidedAt: new Date() }).where(eq(iqRecommendations.id, id));

  it.each([
    ["SUPERSEDED", "SUPERSEDED"],
    ["EXPIRED", "EXPIRED"],
  ] as const)("refuses to approve or reject when the recommendation is %s, changing nothing", async (recStatus, reason) => {
    const paramsHash = hash();
    const recommendationId = await insertRecommendation(org, paramsHash);
    const { id } = await insertAction(org, { paramsHash, recommendationId });
    await closeRecommendation(recommendationId, recStatus);

    expect(await approveAction({ orgId: org.orgId, actionId: id, userId: ME, paramsHash })).toEqual({ ok: false, reason });
    expect(await rejectAction({ orgId: org.orgId, actionId: id, userId: ME, paramsHash })).toEqual({ ok: false, reason });
    expect(await actionRow(id)).toMatchObject({ status: "PENDING_APPROVAL", approvedBy: null, auditLogId: null });
    expect(await auditFor(id)).toHaveLength(0);
    const [rec] = await db().select().from(iqRecommendations).where(eq(iqRecommendations.id, recommendationId));
    expect(rec?.status).toBe(recStatus);
  });

  it("still reports the same person's repeat as success once approval closed the recommendation", async () => {
    const paramsHash = hash();
    const recommendationId = await insertRecommendation(org, paramsHash);
    const { id } = await insertAction(org, { paramsHash, recommendationId });
    expect(await approveAction({ orgId: org.orgId, actionId: id, userId: ME, paramsHash })).toEqual({ ok: true, repeated: false });
    expect(await approveAction({ orgId: org.orgId, actionId: id, userId: ME, paramsHash })).toEqual({ ok: true, repeated: true });
    expect(await rejectAction({ orgId: org.orgId, actionId: id, userId: YOU, paramsHash })).toEqual({ ok: false, reason: "ALREADY_DECIDED" });
  });
});
