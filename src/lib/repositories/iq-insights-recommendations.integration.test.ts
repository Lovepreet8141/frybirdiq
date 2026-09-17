/**
 * iq-insights.ts and iq-recommendations.ts against the local Supabase stack
 * (0034 applied). Two orgs throughout, so every read and write is also a
 * tenancy test.
 *
 * What only a real database can show:
 * 1. Fencing: a write without a live lease — wrong owner, expired, another
 *    org's run, a stale attempt after a takeover — writes nothing.
 * 2. The content-hash rules: NOOP, update while unreferenced, and append +
 *    supersede once a recommendation references the insight (the 0034 freeze
 *    trigger would refuse an in-place update).
 * 3. Recommendations: referenced_at set in the same transaction, NOOP on
 *    retry, open-duplicate and cooldown refusals, and a 23505 collision that
 *    returns NOOP and leaves the transaction usable.
 * 4. Readers are org-scoped, drop and count rows that fail the contract, and
 *    hand back figures minted by observed().
 */
import { createHash, randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/db";
import { iqInsights, iqJobRuns, iqRecommendations } from "@/db/schema";
import { actionParamsHash, computeContentHash, type Insight, type InsightOf } from "@/lib/iq/engine";
import { isLeaseLost } from "@/lib/jobs/fence";
import { createTestOrg, deleteTestOrg, type TestOrg } from "./__test-support__/fixtures";
import { getInsight, listInsights, readFactFigures, writeInsight, type IqTx, type IqWriteLease } from "./iq-insights";
import { listOpenRecommendations, proposeRecommendation, recommendationHistory, type ProposeInput } from "./iq-recommendations";

const HOUR = 3600_000;
const DAY = 24 * HOUR;
const CODE_VERSION = "e116c6f";

const sha = (text: string) => createHash("sha256").update(text).digest("hex");

/** An ISO timestamp in IST with the explicit +05:30 offset the contract requires. */
function ist(date: Date): string {
  const shifted = new Date(date.getTime() + 5.5 * HOUR);
  return `${shifted.toISOString().slice(0, 19)}+05:30`;
}

async function startRun(org: TestOrg, overrides: Partial<typeof iqJobRuns.$inferInsert> = {}): Promise<IqWriteLease> {
  const leaseOwner = randomUUID();
  const [row] = await db()
    .insert(iqJobRuns)
    .values({
      orgId: org.orgId,
      job: "test-engine",
      periodKey: randomUUID(),
      trigger: "MANUAL",
      attempt: 1,
      leaseOwner,
      leaseExpiresAt: sql`now() + interval '5 minutes'`,
      deadlineAt: sql`now() + interval '4 minutes'`,
      codeVersion: CODE_VERSION,
      ...overrides,
    })
    .returning({ id: iqJobRuns.id, attempt: iqJobRuns.attempt, leaseOwner: iqJobRuns.leaseOwner });
  if (!row) throw new Error("iq-insights test: job run insert returned no row");
  return { orgId: org.orgId, runId: row.id, attempt: row.attempt, leaseOwner: row.leaseOwner };
}

type Draft<C extends Insight["claimType"]> = Omit<InsightOf<C>, "contentHash">;

async function sealed<C extends Insight["claimType"]>(draft: Draft<C>): Promise<InsightOf<C>> {
  const contentHash = await computeContentHash({ payload: draft.payload, evidence: draft.evidence });
  return { ...draft, contentHash } as InsightOf<C>;
}

function envelope(org: TestOrg, lease: IqWriteLease, dedupeKey: string) {
  const now = new Date();
  const period = { start: ist(new Date(now.getTime() - DAY)), end: ist(now) };
  return {
    id: randomUUID(),
    orgId: org.orgId,
    locationId: org.locationId,
    schemaVersion: 1 as const,
    producer: "test-engine",
    subject: { kind: "METRIC" as const, ref: "revenue.net" },
    period,
    dedupeKey,
    evidence: [{ kind: "metric" as const, metricId: "revenue.net", period }],
    trust: { state: "NOT_MEASURED" as const },
    copy: { templateId: "test", slots: {} },
    status: "ACTIVE" as const,
    producedBy: { job: "test-engine", runId: lease.runId, attempt: lease.attempt, codeVersion: CODE_VERSION },
    supersedes: null,
    createdAt: ist(now),
    expiresAt: null,
  };
}

/** The content hash each test insight was built with, so a proposal can pin the evidence it read. */
const pinned = new Map<string, string>();

async function fact(org: TestOrg, lease: IqWriteLease, dedupeKey: string, paise: string): Promise<InsightOf<"FACT">> {
  const built = await sealed<"FACT">({
    ...envelope(org, lease, dedupeKey),
    claimType: "FACT",
    payload: {
      metricId: "revenue.net",
      value: { unit: "paise", value: paise },
      sourceQueryId: "orders.net-revenue",
    } as InsightOf<"FACT">["payload"],
  });
  pinned.set(built.id, built.contentHash);
  return built;
}

/** Writes `count` FACT insights for a recommendation to rest on and returns their ids. */
async function evidenceIds(org: TestOrg, lease: IqWriteLease, count = 1): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const e = await fact(org, lease, `evidence:${randomUUID()}`, "100");
    await db().transaction((tx) => write(tx, lease, e));
    ids.push(e.id);
  }
  return ids;
}

/** writeInsight with asOf defaulting to the insight's own period end, as a daily job would pass. */
function write(tx: IqTx, lease: IqWriteLease, insight: Insight, asOf: string = insight.period.end) {
  return writeInsight(tx, lease, insight, { asOf });
}

/** proposeRecommendation with the evidence pinned at the hashes the test built it with, asOf = the period end. */
function propose(
  tx: IqTx,
  lease: IqWriteLease,
  input: Omit<ProposeInput, "evidenceContentHashes" | "asOf"> & Partial<Pick<ProposeInput, "evidenceContentHashes" | "asOf">>,
) {
  const evidenceContentHashes =
    input.evidenceContentHashes ??
    Object.fromEntries(input.insight.payload.evidenceInsightIds.map((id) => [id, pinned.get(id) ?? "0".repeat(64)]));
  return proposeRecommendation(tx, lease, { ...input, evidenceContentHashes, asOf: input.asOf ?? input.insight.period.end });
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function recommendation(
  org: TestOrg,
  lease: IqWriteLease,
  dedupeKey: string,
  evidenceInsightIds: string[],
  highPaise = "300000",
): Promise<InsightOf<"RECOMMENDATION">> {
  const expiresAt = ist(new Date(Date.now() + DAY));
  return sealed<"RECOMMENDATION">({
    ...envelope(org, lease, dedupeKey),
    claimType: "RECOMMENDATION",
    expiresAt,
    evidence: evidenceInsightIds.map((insightId) => ({ kind: "insight" as const, insightId })),
    payload: {
      recommendationId: randomUUID(),
      actionKind: "inventory.flag_recount",
      tier: "A1",
      impact: { low: { unit: "paise", value: "150000" }, high: { unit: "paise", value: highPaise }, basis: "historical" },
      assumptions: [{ code: "COUNT_DRIFT" }],
      confidence: { level: "MEDIUM", reasons: ["SHORT_HISTORY"] },
      expiresAt,
      evidenceInsightIds,
    } as InsightOf<"RECOMMENDATION">["payload"],
  });
}

async function insightRow(id: string) {
  const [row] = await db().select().from(iqInsights).where(eq(iqInsights.id, id));
  return row;
}

async function thrown(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  return undefined;
}

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

describe("fencing", () => {
  it("writes with a live lease", async () => {
    const lease = await startRun(org);
    const insight = await fact(org, lease, `fence:${randomUUID()}`, "100");
    const result = await db().transaction((tx) => write(tx, lease, insight));
    expect(result.outcome).toBe("INSERTED");
  });

  it.each([
    ["a different lease owner", async (lease: IqWriteLease) => ({ ...lease, leaseOwner: randomUUID() })],
    ["another org's run", async (lease: IqWriteLease) => ({ ...(await startRun(otherOrg)), orgId: lease.orgId })],
    [
      "an expired lease",
      async (lease: IqWriteLease) => {
        await db().update(iqJobRuns).set({ leaseExpiresAt: sql`now() - interval '1 second'` }).where(eq(iqJobRuns.id, lease.runId));
        return lease;
      },
    ],
    [
      "a stale attempt after a takeover",
      async (lease: IqWriteLease) => {
        await db()
          .update(iqJobRuns)
          .set({ attempt: lease.attempt + 1, leaseOwner: randomUUID() })
          .where(eq(iqJobRuns.id, lease.runId));
        return lease;
      },
    ],
  ])("refuses %s and writes nothing", async (_case, spoil) => {
    const lease = await startRun(org);
    const insight = await fact(org, lease, `fence:${randomUUID()}`, "100");
    const spoiled = await spoil(lease);
    const error = await thrown(db().transaction((tx) => write(tx, spoiled, insight)));
    expect(isLeaseLost(error)).toBe(true);
    expect(await insightRow(insight.id)).toBeUndefined();
  });
});

describe("writeInsight — content-hash rules", () => {
  it("NOOP on the same content, UPDATE in place while unreferenced", async () => {
    const lease = await startRun(org);
    const dedupeKey = `hash:${randomUUID()}`;
    const first = await fact(org, lease, dedupeKey, "4250000");
    expect((await db().transaction((tx) => write(tx, lease, first))).outcome).toBe("INSERTED");

    const again = { ...first, id: randomUUID() };
    expect(await db().transaction((tx) => write(tx, lease, again))).toEqual({ outcome: "NOOP", insightId: first.id });

    const changed = { ...(await fact(org, lease, dedupeKey, "4300000")), id: randomUUID() };
    expect(await db().transaction((tx) => write(tx, lease, changed))).toEqual({ outcome: "UPDATED", insightId: first.id });
    const row = await insightRow(first.id);
    expect(row?.contentHash).toBe(changed.contentHash);
    expect(row?.payload).toMatchObject({ value: { unit: "paise", value: "4300000" } });
    expect(row?.jobRunId).toBe(lease.runId);
  });

  it("refuses a wrong content hash, another org's insight and another run's insight", async () => {
    const lease = await startRun(org);
    const insight = await fact(org, lease, `bad:${randomUUID()}`, "100");
    expect(String(await thrown(db().transaction((tx) => write(tx, lease, { ...insight, contentHash: sha("x") }))))).toMatch(
      /contentHash/,
    );
    const otherLease = await startRun(otherOrg);
    expect(String(await thrown(db().transaction((tx) => write(tx, otherLease, insight))))).toMatch(/another org/);
    const secondLease = await startRun(org);
    expect(String(await thrown(db().transaction((tx) => write(tx, secondLease, insight))))).toMatch(/this run attempt/);
    expect(await insightRow(insight.id)).toBeUndefined();
  });

  it("supersedes a referenced insight and closes the recommendations resting on it", async () => {
    const lease = await startRun(org);
    const factKey = `evidence:${randomUUID()}`;
    const evidence = await fact(org, lease, factKey, "500000");
    await db().transaction((tx) => write(tx, lease, evidence));

    const rec = await recommendation(org, lease, `rec:${randomUUID()}`, [evidence.id]);
    const proposed = await db().transaction((tx) => propose(tx, lease, { insight: rec, params: { sku: "wings", batch: randomUUID() } }));
    expect(proposed.outcome).toBe("PROPOSED");
    expect((await insightRow(evidence.id))?.referencedAt).not.toBeNull();

    // The freeze trigger is what makes supersede necessary.
    const frozen = await thrown(
      db().update(iqInsights).set({ contentHash: sha("edit") }).where(eq(iqInsights.id, evidence.id)),
    );
    expect(frozen).toBeDefined();

    const revised = await fact(org, lease, factKey, "650000");
    const result = await db().transaction((tx) => write(tx, lease, revised));
    if (proposed.outcome !== "PROPOSED") throw new Error("expected a proposal");
    expect(result).toEqual({
      outcome: "SUPERSEDED",
      insightId: revised.id,
      supersededInsightId: evidence.id,
      supersededRecommendationIds: [proposed.recommendationId],
    });

    const old = await insightRow(evidence.id);
    const fresh = await insightRow(revised.id);
    expect([old?.status, old?.supersededBy, old?.contentHash]).toEqual(["SUPERSEDED", revised.id, evidence.contentHash]);
    expect([fresh?.status, fresh?.supersedes, fresh?.referencedAt]).toEqual(["ACTIVE", evidence.id, null]);

    const [recRow] = await db().select().from(iqRecommendations).where(eq(iqRecommendations.id, proposed.recommendationId));
    expect(recRow?.status).toBe("SUPERSEDED");
    expect(recRow?.decidedAt).not.toBeNull();
    expect((await insightRow(proposed.insightId))?.status).toBe("SUPERSEDED");
  });
});

describe("proposeRecommendation", () => {
  it("marks its insight and evidence referenced in the same transaction, and a retry is a NOOP", async () => {
    const lease = await startRun(org);
    const evidence = await fact(org, lease, `ev:${randomUUID()}`, "100");
    const rec = await recommendation(org, lease, `rec:${randomUUID()}`, [evidence.id]);
    const input = { insight: rec, params: { sku: "thighs", batch: randomUUID() } };

    const seenInside = await db().transaction(async (tx) => {
      await write(tx, lease, evidence);
      const result = await propose(tx, lease, input);
      const [inTx] = await tx.select({ referencedAt: iqInsights.referencedAt }).from(iqInsights).where(eq(iqInsights.id, evidence.id));
      return { result, referencedAt: inTx?.referencedAt ?? null };
    });
    expect(seenInside.result.outcome).toBe("PROPOSED");
    expect(seenInside.referencedAt).not.toBeNull();
    expect((await insightRow(rec.id))?.referencedAt).not.toBeNull();

    expect(await db().transaction((tx) => propose(tx, lease, input))).toEqual({ outcome: "NOOP", insightId: rec.id });
    const rows = await db().select().from(iqRecommendations).where(eq(iqRecommendations.insightId, rec.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ impactUnit: "paise", impactLow: 150000n, impactHigh: 300000n, confidence: "MEDIUM", tier: "A1" });
  });

  it("supersedes its own earlier version under the same dedupe key", async () => {
    const lease = await startRun(org);
    const dedupeKey = `rec:${randomUUID()}`;
    const params = { batch: randomUUID() };
    const v1 = await recommendation(org, lease, dedupeKey, await evidenceIds(org, lease));
    const first = await db().transaction((tx) => propose(tx, lease, { insight: v1, params }));
    const v2 = await recommendation(org, lease, dedupeKey, v1.payload.evidenceInsightIds, "400000");
    const second = await db().transaction((tx) => propose(tx, lease, { insight: v2, params }));
    if (first.outcome !== "PROPOSED" || second.outcome !== "PROPOSED") throw new Error("expected two proposals");
    expect(second.supersededRecommendationIds).toEqual([first.recommendationId]);
    const open = await listOpenRecommendations(org.orgId);
    expect(open.filter((r) => r.id === first.recommendationId)).toEqual([]);
    expect(open.find((r) => r.id === second.recommendationId)?.impactHigh).toBe(400000n);
  });

  it("refuses an open duplicate of the same action under another dedupe key", async () => {
    const lease = await startRun(org);
    const params = { batch: randomUUID() };
    const a = await recommendation(org, lease, `rec:${randomUUID()}`, await evidenceIds(org, lease));
    const first = await db().transaction((tx) => propose(tx, lease, { insight: a, params }));
    const b = await recommendation(org, lease, `rec:${randomUUID()}`, await evidenceIds(org, lease));
    const second = await db().transaction((tx) => propose(tx, lease, { insight: b, params }));
    if (first.outcome !== "PROPOSED") throw new Error("expected a proposal");
    expect(second).toEqual({ outcome: "OPEN_DUPLICATE", openRecommendationId: first.recommendationId });
    expect(await insightRow(b.id)).toBeUndefined();
  });

  it("cools down 7 days after a dismissal and 1 day after an expiry, using database time", async () => {
    const lease = await startRun(org);

    async function closed(status: "DISMISSED" | "EXPIRED", ageMs: number) {
      const params = { batch: randomUUID() };
      const rec = await recommendation(org, lease, `rec:${randomUUID()}`, await evidenceIds(org, lease));
      const first = await db().transaction((tx) => propose(tx, lease, { insight: rec, params }));
      if (first.outcome !== "PROPOSED") throw new Error("expected a proposal");
      await db()
        .update(iqRecommendations)
        .set({
          status,
          decidedAt: sql`now() - ${`${ageMs} milliseconds`}::interval`,
          decidedByUserId: status === "DISMISSED" ? randomUUID() : null,
        })
        .where(and(eq(iqRecommendations.id, first.recommendationId), eq(iqRecommendations.orgId, org.orgId)));
      const next = await recommendation(org, lease, `rec:${randomUUID()}`, await evidenceIds(org, lease));
      return db().transaction((tx) => propose(tx, lease, { insight: next, params }));
    }

    expect(await closed("DISMISSED", 6 * DAY)).toMatchObject({ outcome: "COOLDOWN", reason: "DISMISSED_COOLDOWN" });
    expect((await closed("DISMISSED", 7 * DAY + HOUR)).outcome).toBe("PROPOSED");
    expect(await closed("EXPIRED", 12 * HOUR)).toMatchObject({ outcome: "COOLDOWN", reason: "EXPIRED_COOLDOWN" });
    expect((await closed("EXPIRED", DAY + HOUR)).outcome).toBe("PROPOSED");
  });

  it("turns a 23505 on the open-duplicate index into a NOOP and keeps the transaction usable", async () => {
    const lease = await startRun(org);
    const recDedupe = `rec:${randomUUID()}`;
    // Another run's open recommendation already holds this dedupe key, for a different action params hash.
    const holder = await recommendation(org, lease, `holder:${randomUUID()}`, await evidenceIds(org, lease));
    const held = await db().transaction((tx) => propose(tx, lease, { insight: holder, params: { batch: randomUUID() } }));
    if (held.outcome !== "PROPOSED") throw new Error("expected a proposal");
    await db().update(iqRecommendations).set({ dedupeKey: recDedupe }).where(eq(iqRecommendations.id, held.recommendationId));

    const mine = await recommendation(org, lease, recDedupe, await evidenceIds(org, lease));
    const outcome = await db().transaction(async (tx) => {
      const result = await propose(tx, lease, { insight: mine, params: { batch: randomUUID() } });
      const [check] = await tx.execute<{ ok: number }>(sql`SELECT 1 AS ok`);
      return { result, usable: check?.ok === 1 };
    });
    expect(outcome).toEqual({ result: { outcome: "NOOP", insightId: mine.id }, usable: true });
  });
});

describe("readers are org-scoped", () => {
  it("list, get and fact figures never cross orgs, and figures come back as observed quantities", async () => {
    const metricId = `metric.${randomUUID().slice(0, 8)}`;
    const lease = await startRun(org);
    const mine = await sealed<"FACT">({
      ...(await fact(org, lease, `scope:${randomUUID()}`, "990000")),
      payload: { metricId, value: { unit: "paise", value: "990000" }, sourceQueryId: "orders.net-revenue" } as InsightOf<"FACT">["payload"],
    });
    await db().transaction((tx) => write(tx, lease, mine));

    const otherLease = await startRun(otherOrg);
    const theirs = await sealed<"FACT">({
      ...(await fact(otherOrg, otherLease, `scope:${randomUUID()}`, "1")),
      payload: { metricId, value: { unit: "paise", value: "1" }, sourceQueryId: "orders.net-revenue" } as InsightOf<"FACT">["payload"],
    });
    await db().transaction((tx) => write(tx, otherLease, theirs));

    const listed = await listInsights(otherOrg.orgId, { claimTypes: ["FACT"], limit: 500 });
    expect(listed.insights.map((i) => i.orgId).every((id) => id === otherOrg.orgId)).toBe(true);
    expect(listed.insights.some((i) => i.id === mine.id)).toBe(false);
    expect(await getInsight(otherOrg.orgId, mine.id)).toBeNull();
    expect((await getInsight(org.orgId, mine.id))?.claimType).toBe("FACT");

    const figures = await readFactFigures(org.orgId, metricId);
    expect(figures).toEqual({
      figures: [{ insightId: mine.id, period: expect.any(Object), value: { unit: "paise", value: "990000" } }],
      dropped: 0,
    });
    const history = await recommendationHistory(otherOrg.orgId, "inventory.flag_recount", sha("none"));
    expect([history.open, history.latestClosed]).toEqual([null, null]);
  });

  it("drops and counts stored rows that fail the contract or carry personal data", async () => {
    const lonely = await createTestOrg();
    try {
      const lease = await startRun(lonely);
      const good = await fact(lonely, lease, `ok:${randomUUID()}`, "100");
      await db().transaction((tx) => write(tx, lease, good));
      const bad = { payload: { metricId: "revenue.net", value: { unit: "paise", value: 1.5 }, sourceQueryId: "q" } };
      const pii = {
        payload: { metricId: "revenue.net", value: { unit: "paise", value: "5" }, sourceQueryId: "q" },
        evidence: [{ kind: "query", sourceId: "call 9876543210", paramsHash: sha("p") }],
      };
      for (const override of [bad, pii]) {
        await db().insert(iqInsights).values({
          orgId: lonely.orgId,
          claimType: "FACT",
          producer: "test",
          subjectKind: "METRIC",
          subjectRef: "revenue.net",
          periodStart: new Date(Date.now() - HOUR),
          periodEnd: new Date(),
          asOf: new Date(),
          dedupeKey: `raw:${randomUUID()}`,
          evidence: [{ kind: "insight", insightId: randomUUID() }],
          codeVersion: CODE_VERSION,
          contentHash: sha("raw"),
          ...override,
        });
      }
      const read = await listInsights(lonely.orgId);
      expect(read.insights.map((i) => i.id)).toEqual([good.id]);
      expect(read.dropped).toBe(2);
    } finally {
      await deleteTestOrg(lonely.orgId);
    }
  });
});

describe("proposeRecommendation — params are validated and hashed server-side (SECURITY R1, R2)", () => {
  it.each([
    ["a personal-data key", { customer_phone: "x" }],
    ["a phone-shaped value", { contact: "9876543210" }],
    ["a nested object", { target: { sku: "wings" } }],
    ["an over-long string", { note: "x".repeat(201) }],
  ])("refuses %s and writes nothing", async (_case, params) => {
    const lease = await startRun(org);
    const rec = await recommendation(org, lease, `rec:${randomUUID()}`, await evidenceIds(org, lease));
    const error = await thrown(
      db().transaction((tx) => propose(tx, lease, { insight: rec, params: params as Record<string, string> })),
    );
    expect(String(error)).toMatch(/invalid action params/);
    expect(await insightRow(rec.id)).toBeUndefined();
  });

  it("stores the hash it computed from canonical params, so key order cannot split one action in two", async () => {
    const lease = await startRun(org);
    const batch = randomUUID();
    const a = await recommendation(org, lease, `rec:${randomUUID()}`, await evidenceIds(org, lease));
    const first = await db().transaction((tx) =>
      propose(tx, lease, { insight: a, params: { sku: "wings", batch, quantity: 4 } }),
    );
    if (first.outcome !== "PROPOSED") throw new Error("expected a proposal");
    const [row] = await db().select().from(iqRecommendations).where(eq(iqRecommendations.id, first.recommendationId));
    expect(row?.paramsHash).toBe(await actionParamsHash({ batch, quantity: 4, sku: "wings" }));
    expect(row?.params).toEqual({ sku: "wings", batch, quantity: 4 });

    const b = await recommendation(org, lease, `rec:${randomUUID()}`, await evidenceIds(org, lease));
    const second = await db().transaction((tx) =>
      propose(tx, lease, { insight: b, params: { quantity: 4, batch, sku: "wings" } }),
    );
    expect(second).toEqual({ outcome: "OPEN_DUPLICATE", openRecommendationId: first.recommendationId });
  });

  it("refuses a caller's params hash that does not match the params", async () => {
    const lease = await startRun(org);
    const rec = await recommendation(org, lease, `rec:${randomUUID()}`, await evidenceIds(org, lease));
    const error = await thrown(
      db().transaction((tx) =>
        propose(tx, lease, { insight: rec, params: { batch: randomUUID() }, expectedParamsHash: sha("other") }),
      ),
    );
    expect(String(error)).toMatch(/params hash/);
    expect(await insightRow(rec.id)).toBeUndefined();
  });

  it("refuses an action kind outside the catalog, a tier that disagrees with it, and a kind blocked by an owner decision", async () => {
    const lease = await startRun(org);
    async function attempt(actionKind: string, tier: "A1" | "A2") {
      const rec = await recommendation(org, lease, `rec:${randomUUID()}`, await evidenceIds(org, lease));
      const insight = await sealed<"RECOMMENDATION">({ ...rec, payload: { ...rec.payload, actionKind, tier } });
      const result = await thrown(
        db().transaction((tx) => propose(tx, lease, { insight, params: { batch: randomUUID() } })),
      );
      return { result, stored: await insightRow(insight.id) };
    }
    const unknown = await attempt("inventory.delete_everything", "A1");
    expect(String(unknown.result)).toMatch(/catalog/);
    const wrongTier = await attempt("inventory.flag_recount", "A2");
    expect(String(wrongTier.result)).toMatch(/tier/);
    const blocked = await attempt("customer.winback_message", "A2");
    expect(String(blocked.result)).toMatch(/dec-5/);
    expect([unknown.stored, wrongTier.stored, blocked.stored]).toEqual([undefined, undefined, undefined]);
  });
});

describe("proposeRecommendation — concurrency and re-proposal (RELIABILITY M1, M2, S1)", () => {
  it("M1: refuses evidence that is missing, not ACTIVE, or no longer at the pinned hash", async () => {
    const lease = await startRun(org);
    const [e] = await evidenceIds(org, lease);
    const rec = await recommendation(org, lease, `rec:${randomUUID()}`, [e!]);
    const stale = await db().transaction((tx) => propose(tx, lease, { insight: rec, params: { batch: randomUUID() }, evidenceContentHashes: { [e!]: sha("old") } }));
    expect(stale).toEqual({ outcome: "STALE_EVIDENCE", insightIds: [e] });

    const ghost = randomUUID();
    const onGhost = await recommendation(org, lease, `rec:${randomUUID()}`, [ghost]);
    const missing = await db().transaction((tx) => propose(tx, lease, { insight: onGhost, params: { batch: randomUUID() }, evidenceContentHashes: { [ghost]: sha("x") } }));
    expect(missing).toEqual({ outcome: "STALE_EVIDENCE", insightIds: [ghost] });
    expect([await insightRow(rec.id), await insightRow(onGhost.id)]).toEqual([undefined, undefined]);
  });

  /** Runs `first` in a transaction held open until `second` has had time to block on it. */
  async function race<A, B>(first: (tx: IqTx) => Promise<A>, second: (tx: IqTx) => Promise<B>) {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let firstWrote!: () => void;
    const wrote = new Promise<void>((resolve) => (firstWrote = resolve));
    const a = db().transaction(async (tx) => {
      const result = await first(tx);
      firstWrote();
      await gate;
      return result;
    });
    await wrote;
    let secondDone = false;
    const b = db()
      .transaction((tx) => second(tx))
      .finally(() => (secondDone = true));
    await sleep(400);
    const finishedWhileFirstOpen = secondDone;
    release();
    return { a: await a, b: await b, finishedWhileFirstOpen };
  }

  it("M1(a): a proposal racing an in-place update of its evidence does not freeze content it never read", async () => {
    const leaseW = await startRun(org);
    const leaseR = await startRun(org);
    const key = `evidence:${randomUUID()}`;
    const e = await fact(org, leaseW, key, "100");
    await db().transaction((tx) => write(tx, leaseW, e));
    const changed = await fact(org, leaseW, key, "200");
    const rec = await recommendation(org, leaseR, `rec:${randomUUID()}`, [e.id]);

    const { a, b } = await race(
      (tx) => write(tx, leaseW, { ...changed, id: randomUUID() }),
      (tx) => propose(tx, leaseR, { insight: rec, params: { batch: randomUUID() }, evidenceContentHashes: { [e.id]: e.contentHash } }),
    );
    expect(a.outcome).toBe("UPDATED");
    expect(b).toEqual({ outcome: "STALE_EVIDENCE", insightIds: [e.id] });
    expect((await insightRow(e.id))?.referencedAt).toBeNull();
  });

  it("M1(b): a proposal racing the supersede of its evidence is refused instead of resting on a SUPERSEDED insight", async () => {
    const lease = await startRun(org);
    const leaseR = await startRun(org);
    const key = `evidence:${randomUUID()}`;
    const e = await fact(org, lease, key, "100");
    await db().transaction((tx) => write(tx, lease, e));
    const earlier = await recommendation(org, lease, `rec:${randomUUID()}`, [e.id]);
    expect((await db().transaction((tx) => propose(tx, lease, { insight: earlier, params: { batch: randomUUID() } }))).outcome).toBe("PROPOSED");

    const revised = await fact(org, lease, key, "300");
    const rec = await recommendation(org, leaseR, `rec:${randomUUID()}`, [e.id]);
    const { a, b } = await race(
      (tx) => write(tx, lease, revised),
      (tx) => propose(tx, leaseR, { insight: rec, params: { batch: randomUUID() }, evidenceContentHashes: { [e.id]: e.contentHash } }),
    );
    expect(a.outcome).toBe("SUPERSEDED");
    expect(b).toEqual({ outcome: "STALE_EVIDENCE", insightIds: [e.id] });
    const open = await db()
      .select({ id: iqRecommendations.id })
      .from(iqRecommendations)
      .where(and(eq(iqRecommendations.orgId, org.orgId), eq(iqRecommendations.insightId, rec.id)));
    expect(open).toEqual([]);
  });

  it("M2: the same recommendation comes back once its dismissal cooldown has passed", async () => {
    const lease = await startRun(org);
    const dedupeKey = `rec:${randomUUID()}`;
    const params = { batch: randomUUID() };
    const evidence = await evidenceIds(org, lease);
    const v1 = await recommendation(org, lease, dedupeKey, evidence);
    const first = await db().transaction((tx) => propose(tx, lease, { insight: v1, params }));
    if (first.outcome !== "PROPOSED") throw new Error("expected a proposal");
    await db()
      .update(iqRecommendations)
      .set({ status: "DISMISSED", decidedAt: sql`now() - interval '8 days'`, decidedByUserId: randomUUID() })
      .where(eq(iqRecommendations.id, first.recommendationId));

    // Identical content, as a rule re-deriving it would produce — only the id is new.
    const again = { ...v1, id: randomUUID() };
    const second = await db().transaction((tx) => propose(tx, lease, { insight: again, params }));
    expect(second).toMatchObject({ outcome: "PROPOSED", insightId: again.id });
    const old = await insightRow(v1.id);
    expect([old?.status, old?.supersededBy]).toEqual(["SUPERSEDED", again.id]);
  });

  it("M2: an identical proposal while the recommendation is still PROPOSED stays a NOOP", async () => {
    const lease = await startRun(org);
    const params = { batch: randomUUID() };
    const v1 = await recommendation(org, lease, `rec:${randomUUID()}`, await evidenceIds(org, lease));
    await db().transaction((tx) => propose(tx, lease, { insight: v1, params }));
    const again = { ...v1, id: randomUUID() };
    expect(await db().transaction((tx) => propose(tx, lease, { insight: again, params }))).toEqual({ outcome: "NOOP", insightId: v1.id });
  });

  it("S1: two concurrent proposers of the same action under different dedupe keys open only one recommendation", async () => {
    const leaseA = await startRun(org);
    const leaseB = await startRun(org);
    const params = { batch: randomUUID() };
    const a = await recommendation(org, leaseA, `rec:${randomUUID()}`, await evidenceIds(org, leaseA));
    const b = await recommendation(org, leaseB, `rec:${randomUUID()}`, await evidenceIds(org, leaseB));

    const result = await race(
      (tx) => propose(tx, leaseA, { insight: a, params }),
      (tx) => propose(tx, leaseB, { insight: b, params }),
    );
    expect(result.finishedWhileFirstOpen).toBe(false);
    if (result.a.outcome !== "PROPOSED") throw new Error("expected the first proposer to win");
    expect(result.b).toEqual({ outcome: "OPEN_DUPLICATE", openRecommendationId: result.a.recommendationId });
  });
});
