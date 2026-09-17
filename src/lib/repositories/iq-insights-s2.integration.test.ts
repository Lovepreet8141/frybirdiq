/**
 * iq-insights.ts S2 behaviour on this worktree's own database (hive/tools/test-db.sh):
 * full Insight round trip, the as_of guard (STALE_WRITE), copy/trust updates on
 * an unchanged claim, expireInsights as a fenced compare-and-set, a rolled-back
 * chunk that must not expire anything, and the finance.view loader gate.
 */
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/db";
import { iqInsights, iqJobRuns, iqRecommendations } from "@/db/schema";
import { computeContentHash, present, viewerFor, type Insight, type InsightOf, type TrustRef } from "@/lib/iq/engine";
import { createTestOrg, deleteTestOrg, type TestOrg } from "./__test-support__/fixtures";
import { expireInsights, getInsight, loadInsightsFor, writeInsight, type IqTx, type IqWriteLease } from "./iq-insights";

const HOUR = 3600_000;
const D = "2026-09-11";
const DAY_START = `${D}T00:00:00+05:30`;
const DAY_END = "2026-09-12T00:00:00+05:30";
const LATER = "2026-09-13T00:00:00+05:30";

let org: TestOrg;

beforeAll(async () => {
  org = await createTestOrg();
});

afterAll(async () => {
  if (org) await deleteTestOrg(org.orgId);
});

async function startRun(): Promise<IqWriteLease> {
  const [row] = await db()
    .insert(iqJobRuns)
    .values({
      orgId: org.orgId,
      job: "iq-detect-daily",
      periodKey: randomUUID(),
      trigger: "MANUAL",
      attempt: 1,
      leaseOwner: randomUUID(),
      leaseExpiresAt: sql`now() + interval '5 minutes'`,
      deadlineAt: sql`now() + interval '4 minutes'`,
      codeVersion: "060e8cd",
    })
    .returning({ id: iqJobRuns.id, attempt: iqJobRuns.attempt, leaseOwner: iqJobRuns.leaseOwner });
  if (!row) throw new Error("no run");
  return { orgId: org.orgId, runId: row.id, attempt: row.attempt, leaseOwner: row.leaseOwner };
}

const MEASURED = (score: number): TrustRef => ({
  state: "MEASURED",
  score,
  asOf: "2026-09-12T02:10:00+05:30",
  metricIds: ["revenue_net"],
  reasons: ["GRADE_HIGH", "T1_RECIPE_COVERAGE"],
});

async function detection(
  lease: IqWriteLease,
  options: { dedupeKey?: string; producer?: string; value?: string; trust?: TrustRef; templateId?: string; id?: string } = {},
): Promise<InsightOf<"DETECTION">> {
  const period = { start: DAY_START, end: DAY_END };
  const evidence = [{ kind: "metric" as const, metricId: "revenue_net", period }];
  const payload = {
    ruleId: "sales.below_weekday_baseline",
    observed: { unit: "paise", value: options.value ?? "600000" },
    baseline: { method: "median_mad", value: { unit: "paise", value: "1000000" }, windowWeeks: 8 },
    deviationBps: -4000,
    severity: 3,
  } as InsightOf<"DETECTION">["payload"];
  return {
    id: options.id ?? randomUUID(),
    orgId: org.orgId,
    locationId: null,
    schemaVersion: 1,
    producer: options.producer ?? "detect.baseline",
    subject: { kind: "METRIC", ref: "revenue_net" },
    period,
    dedupeKey: options.dedupeKey ?? `detect:sales.below_weekday_baseline:${randomUUID()}`,
    evidence,
    trust: options.trust ?? MEASURED(95),
    copy: { templateId: options.templateId ?? "detect.sales.below_weekday_baseline", slots: { observed: "observed", baseline: "baseline.value" } },
    status: "ACTIVE",
    producedBy: { job: "iq-detect-daily", runId: lease.runId, attempt: lease.attempt, codeVersion: "060e8cd" },
    contentHash: await computeContentHash({ payload, evidence }),
    supersedes: null,
    createdAt: "2026-09-12T02:45:00+05:30",
    expiresAt: null,
    claimType: "DETECTION",
    payload,
  };
}

const inTx = <T>(work: (tx: IqTx) => Promise<T>) => db().transaction(work);

async function row(id: string) {
  const [r] = await db().select().from(iqInsights).where(eq(iqInsights.id, id));
  return r;
}

/** Marks an insight referenced the way 0034's trigger would, for tests that need a frozen row. */
async function reference(id: string) {
  await db().update(iqInsights).set({ referencedAt: new Date() }).where(eq(iqInsights.id, id));
}

describe("round trip", () => {
  it("reads back exactly the Insight that was written, ready for present()", async () => {
    const lease = await startRun();
    const written = await detection(lease);
    await inTx((tx) => writeInsight(tx, lease, written, { asOf: DAY_END }));
    const read = await getInsight(org.orgId, written.id);
    expect(read).not.toBeNull();
    const { asOf, statusReason, referencedAt, supersededBy, ...insight } = read!;
    expect(insight).toEqual({ ...written, createdAt: expect.any(String) });
    expect([asOf.toISOString(), statusReason, referencedAt, supersededBy]).toEqual(["2026-09-11T18:30:00.000Z", null, null, null]);
    expect(present(read as Insight)).toMatchObject({ kind: "DETECTION", badge: { label: "Detected" }, trust: { text: "Data trust 95/100" } });
  });

  it("drops a row whose job run was pruned rather than inventing its job", async () => {
    const lease = await startRun();
    const written = await detection(lease);
    await inTx((tx) => writeInsight(tx, lease, written, { asOf: DAY_END }));
    await db().delete(iqJobRuns).where(eq(iqJobRuns.id, lease.runId));
    expect(await getInsight(org.orgId, written.id)).toBeNull();
  });
});

describe("as_of guard (RELIABILITY C5, U2)", () => {
  it("refuses an older write with STALE_WRITE and keeps the newer row; the same asOf again is a NOOP", async () => {
    const lease = await startRun();
    const newer = await detection(lease, { value: "700000" });
    await inTx((tx) => writeInsight(tx, lease, newer, { asOf: LATER }));
    const older = await detection(lease, { dedupeKey: newer.dedupeKey, value: "500000" });
    expect(await inTx((tx) => writeInsight(tx, lease, older, { asOf: DAY_END }))).toEqual({ outcome: "STALE_WRITE", insightId: newer.id });
    expect((await row(newer.id))?.payload).toMatchObject({ observed: { value: "700000" } });
    expect(await inTx((tx) => writeInsight(tx, lease, { ...newer, id: randomUUID() }, { asOf: LATER }))).toEqual({ outcome: "NOOP", insightId: newer.id });
  });

  it("refuses an asOf without the IST offset", async () => {
    const lease = await startRun();
    const insight = await detection(lease);
    await expect(inTx((tx) => writeInsight(tx, lease, insight, { asOf: "2026-09-11T18:30:00Z" }))).rejects.toThrow();
  });
});

describe("unchanged claim, new copy or trust (ARCHITECT R4)", () => {
  it("unreferenced: updates copy and trust in place", async () => {
    const lease = await startRun();
    const first = await detection(lease, { trust: MEASURED(95) });
    await inTx((tx) => writeInsight(tx, lease, first, { asOf: DAY_END }));
    const again = { ...(await detection(lease, { dedupeKey: first.dedupeKey, trust: MEASURED(40), templateId: "detect.sales.v2" })), id: randomUUID() };
    expect(await inTx((tx) => writeInsight(tx, lease, again, { asOf: DAY_END }))).toEqual({ outcome: "UPDATED", insightId: first.id });
    const stored = await row(first.id);
    expect([stored?.trustScore, (stored?.copy as { templateId: string }).templateId]).toEqual([40, "detect.sales.v2"]);
  });

  it("referenced: updates trust only; a new wording supersedes with a new row", async () => {
    const lease = await startRun();
    const first = await detection(lease, { trust: MEASURED(95) });
    await inTx((tx) => writeInsight(tx, lease, first, { asOf: DAY_END }));
    await reference(first.id);

    const newTrust = { ...(await detection(lease, { dedupeKey: first.dedupeKey, trust: MEASURED(60) })), id: randomUUID() };
    expect(await inTx((tx) => writeInsight(tx, lease, newTrust, { asOf: DAY_END }))).toEqual({ outcome: "UPDATED", insightId: first.id });
    expect((await row(first.id))?.trustScore).toBe(60);

    const newWords = { ...(await detection(lease, { dedupeKey: first.dedupeKey, trust: MEASURED(60), templateId: "detect.sales.v3" })), id: randomUUID() };
    expect(await inTx((tx) => writeInsight(tx, lease, newWords, { asOf: DAY_END }))).toMatchObject({ outcome: "SUPERSEDED", insightId: newWords.id, supersededInsightId: first.id });
    expect([(await row(first.id))?.status, (await row(first.id))?.statusReason]).toEqual(["SUPERSEDED", "SUPERSEDED"]);
  });
});

describe("expireInsights (RELIABILITY C5, C6)", () => {
  it("expires with CLEARED at a newer or equal asOf, refuses an older one, and counts absent keys", async () => {
    const lease = await startRun();
    const a = await detection(lease);
    const b = await detection(lease);
    await inTx(async (tx) => {
      await writeInsight(tx, lease, a, { asOf: DAY_END });
      await writeInsight(tx, lease, b, { asOf: LATER });
    });
    const result = await inTx((tx) =>
      expireInsights(tx, lease, [
        { dedupeKey: a.dedupeKey, asOf: DAY_END, reason: "CLEARED" },
        { dedupeKey: b.dedupeKey, asOf: DAY_END, reason: "CLEARED" },
        { dedupeKey: "detect:none:2026-09-11", asOf: DAY_END, reason: "CLEARED" },
      ]),
    );
    expect(result).toMatchObject({ expired: 1, expiredIds: [a.id], staleWrites: 1, absent: 1 });
    expect([(await row(a.id))?.status, (await row(a.id))?.statusReason, (await row(b.id))?.status]).toEqual(["EXPIRED", "CLEARED", "ACTIVE"]);
  });

  it("expiring a referenced insight closes the PROPOSED recommendations resting on it first", async () => {
    const lease = await startRun();
    const evidence = await detection(lease);
    await inTx((tx) => writeInsight(tx, lease, evidence, { asOf: DAY_END }));
    const recInsight = await detection(lease);
    await inTx((tx) => writeInsight(tx, lease, recInsight, { asOf: DAY_END }));
    // A PROPOSED recommendation citing `evidence`, inserted directly (its own claim shape is covered elsewhere).
    await db().update(iqInsights).set({ claimType: "RECOMMENDATION", payload: { evidenceInsightIds: [evidence.id] }, expiresAt: new Date(Date.now() + 24 * HOUR) }).where(eq(iqInsights.id, recInsight.id));
    const [rec] = await db()
      .insert(iqRecommendations)
      .values({
        orgId: org.orgId,
        insightId: recInsight.id,
        actionKind: "inventory.flag_recount",
        tier: "A1",
        paramsHash: "b".repeat(64),
        impactUnit: "paise",
        impactLow: 1n,
        impactHigh: 2n,
        confidence: "LOW",
        assumptions: [{ code: "X" }],
        expiresAt: new Date(Date.now() + 24 * HOUR),
        dedupeKey: `rec:${randomUUID()}`,
      })
      .returning({ id: iqRecommendations.id });
    expect((await row(evidence.id))?.referencedAt).not.toBeNull();

    const result = await inTx((tx) => expireInsights(tx, lease, [{ dedupeKey: evidence.dedupeKey, asOf: DAY_END, reason: "CLEARED" }]));
    expect(result).toMatchObject({ expired: 1, supersededRecommendationIds: [rec!.id] });
    const [recRow] = await db().select().from(iqRecommendations).where(eq(iqRecommendations.id, rec!.id));
    expect(recRow?.status).toBe("SUPERSEDED");
  });

  it("a chunk that rolls back (a PARTIAL run at its deadline) expires nothing; the committed chunk before it stands", async () => {
    const lease = await startRun();
    const a = await detection(lease);
    const b = await detection(lease);
    await inTx(async (tx) => {
      await writeInsight(tx, lease, a, { asOf: DAY_END });
      await writeInsight(tx, lease, b, { asOf: DAY_END });
    });
    await inTx((tx) => expireInsights(tx, lease, [{ dedupeKey: a.dedupeKey, asOf: DAY_END, reason: "CLEARED" }]));
    await expect(
      inTx(async (tx) => {
        await expireInsights(tx, lease, [{ dedupeKey: b.dedupeKey, asOf: DAY_END, reason: "CLEARED" }]);
        throw new Error("DEADLINE");
      }),
    ).rejects.toThrow("DEADLINE");
    expect([(await row(a.id))?.status, (await row(b.id))?.status]).toEqual(["EXPIRED", "ACTIVE"]);
  });

  it("re-running the same expiry is harmless", async () => {
    const lease = await startRun();
    const a = await detection(lease);
    await inTx((tx) => writeInsight(tx, lease, a, { asOf: DAY_END }));
    const request = [{ dedupeKey: a.dedupeKey, asOf: DAY_END, reason: "CLEARED" as const }];
    await inTx((tx) => expireInsights(tx, lease, request));
    expect(await inTx((tx) => expireInsights(tx, lease, request))).toMatchObject({ expired: 0, absent: 1 });
  });
});

describe("loadInsightsFor: ANALYST vs MANAGER (R2.2)", () => {
  it("keeps recon./sig. findings from ANALYST and ADMIN with no count, and shows them to MANAGER", async () => {
    const own = await createTestOrg();
    const saved = org;
    org = own;
    try {
      const lease = await startRun();
      const recon = await detection(lease, { producer: "recon.capture_vs_total", dedupeKey: `recon:capture_vs_total:${D}` });
      const sig = await detection(lease, { producer: "sig.double_capture", dedupeKey: "sig:double_capture" });
      const ordinary = await detection(lease);
      await inTx(async (tx) => {
        for (const insight of [recon, sig, ordinary]) await writeInsight(tx, lease, insight, { asOf: DAY_END });
      });

      const analyst = await loadInsightsFor(own.orgId, viewerFor(["ANALYST"]), { claimTypes: ["DETECTION"] });
      expect(analyst.items.map((i) => i.presentation.insightId)).toEqual([ordinary.id]);
      expect(analyst).toMatchObject({ restricted: true, dropped: 0 });
      expect(JSON.stringify(analyst)).not.toContain("recon");

      const admin = await loadInsightsFor(own.orgId, viewerFor(["ADMIN"]), { claimTypes: ["DETECTION"] });
      expect(admin.items.map((i) => i.presentation.insightId)).toEqual([ordinary.id]);

      const manager = await loadInsightsFor(own.orgId, viewerFor(["MANAGER"]), { claimTypes: ["DETECTION"] });
      expect(manager.items.map((i) => i.presentation.insightId).sort()).toEqual([recon.id, sig.id, ordinary.id].sort());
      expect(manager.restricted).toBe(false);
      expect(manager.items[0]).toMatchObject({ status: "ACTIVE", statusReason: null, asOf: expect.any(Date) });
    } finally {
      org = saved;
      await deleteTestOrg(own.orgId);
    }
  });
});
