import "server-only";

/**
 * Insights — where the intelligence engine's claims are stored and read.
 *
 * hive/reviews/iq-0 DESIGN.md §2 and DESIGN-v2-DELTA.md §3, over migration
 * 0034. Two rules shape every function here:
 *
 * **Writes are fenced.** A job writes only while it holds its run's lease.
 * Every writer first locks the run row and checks the lease (`assertLease`);
 * a stalled attempt that wakes after a takeover gets `LeaseLostError` and its
 * transaction writes nothing. Inside the job runner's fenced commit the row
 * is already locked by the same transaction, so the check is free; called
 * anywhere else, the lock it takes is itself the fence.
 *
 * **What a decision rests on is never rewritten.** `writeInsight` compares
 * content hashes on the org's ACTIVE row with the same dedupe key:
 *   - same hash → nothing to write (NOOP);
 *   - different hash, nothing references the row yet → update it in place;
 *   - different hash (or a re-proposal after cooldown), referenced → the old
 *     row becomes SUPERSEDED, a new row
 *     supersedes it, and every still-PROPOSED recommendation that cited the
 *     old row (as its own insight or as evidence) is SUPERSEDED with it.
 * The database backs this up: a referenced insight's content is frozen by a
 * trigger in 0034, so a bug here fails loudly instead of editing history.
 *
 * Every query filters on org_id itself. The app connects as `postgres`,
 * which bypasses row-level security.
 */

import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { iqInsights } from "@/db/schema";
import {
  AutomationPayloadSchema,
  DetectionPayloadSchema,
  EvidenceSchema,
  ExplanationPayloadSchema,
  FactPayloadSchema,
  ForecastPayloadSchema,
  InsightSchema,
  RecommendationPayloadSchema,
  findPersonalData,
  hasValidContentHash,
  type ClaimType,
  type Evidence,
  type Insight,
  type Observed,
  type Quantity,
} from "@/lib/iq/engine";
import { observed } from "@/lib/iq/engine/observed-factory";
import { LeaseLostError, type LeaseToken } from "@/lib/jobs/fence";

export type IqTx = Parameters<Parameters<ReturnType<typeof db>["transaction"]>[0]>[0];

/** A job-run lease plus the org the run belongs to. */
export type IqWriteLease = LeaseToken & { readonly orgId: string };

/**
 * Locks the run row and checks the lease is still this attempt's. Uses
 * clock_timestamp(), not now(): now() is the transaction's start and would
 * accept a lease that expired while the transaction was open.
 */
export async function assertLease(tx: IqTx, lease: IqWriteLease): Promise<void> {
  const rows = await tx.execute<{ id: string }>(sql`
    SELECT id FROM iq_job_runs
    WHERE id = ${lease.runId}
      AND org_id = ${lease.orgId}
      AND attempt = ${lease.attempt}
      AND lease_owner = ${lease.leaseOwner}
      AND status = 'RUNNING'
      AND lease_expires_at > clock_timestamp()
    FOR UPDATE
  `);
  if (rows.length !== 1) throw new LeaseLostError(lease);
}

export type WriteInsightOutcome = "INSERTED" | "NOOP" | "UPDATED" | "SUPERSEDED";

export type WriteInsightResult = {
  readonly outcome: WriteInsightOutcome;
  /** The stored row that now carries this claim. On UPDATED and NOOP it is the existing row's id. */
  readonly insightId: string;
  /** On SUPERSEDED: the row that was replaced, and the recommendations closed with it. */
  readonly supersededInsightId?: string;
  readonly supersededRecommendationIds?: readonly string[];
};

/** Refuses anything that is not a valid, correctly hashed ACTIVE claim of this run and org. */
async function checkWritable(insight: Insight, lease: IqWriteLease): Promise<Insight> {
  const parsed = InsightSchema.parse(insight);
  if (parsed.orgId !== lease.orgId) throw new Error("iq-insights: insight belongs to another org");
  if (parsed.producedBy.runId !== lease.runId || parsed.producedBy.attempt !== lease.attempt) {
    throw new Error("iq-insights: insight was not produced by this run attempt");
  }
  if (parsed.status !== "ACTIVE") throw new Error("iq-insights: only ACTIVE insights are written; status changes go through supersede");
  if (!(await hasValidContentHash(parsed))) throw new Error("iq-insights: contentHash does not match payload and evidence");
  return parsed;
}

function contentColumns(insight: Insight, lease: IqWriteLease) {
  return {
    locationId: insight.locationId,
    claimType: insight.claimType,
    schemaVersion: insight.schemaVersion,
    producer: insight.producer,
    subjectKind: insight.subject.kind,
    subjectRef: insight.subject.ref,
    periodStart: new Date(insight.period.start),
    periodEnd: new Date(insight.period.end),
    severity: insight.claimType === "DETECTION" ? insight.payload.severity : null,
    payload: insight.payload as unknown as Record<string, unknown>,
    evidence: insight.evidence as unknown[],
    trustState: insight.trust.state,
    trustScore: insight.trust.state === "MEASURED" ? insight.trust.score : null,
    trustAsOf: insight.trust.state === "MEASURED" ? new Date(insight.trust.asOf) : null,
    // Migration 0038 columns. as_of = the period end until S2 adds an explicit asOf (RELIABILITY C5).
    trustMetricIds: insight.trust.state === "MEASURED" ? [...insight.trust.metricIds] : [],
    trustReasons: insight.trust.state === "NOT_MEASURED" ? [] : [...insight.trust.reasons],
    copy: insight.copy,
    asOf: new Date(insight.period.end),
    jobRunId: lease.runId,
    jobAttempt: lease.attempt,
    codeVersion: insight.producedBy.codeVersion,
    contentHash: insight.contentHash,
    expiresAt: insight.expiresAt === null ? null : new Date(insight.expiresAt),
  };
}

/**
 * Closes every PROPOSED recommendation that rests on `insightId` — as its own
 * RECOMMENDATION insight or through payload.evidenceInsightIds — and marks
 * those recommendations' own insights SUPERSEDED so no feed shows them.
 */
async function supersedeRecommendationsCiting(tx: IqTx, orgId: string, insightId: string): Promise<string[]> {
  const rows = await tx.execute<{ id: string }>(sql`
    WITH affected AS (
      SELECT r.id, r.insight_id
      FROM iq_recommendations r
      JOIN iq_insights i ON i.id = r.insight_id AND i.org_id = r.org_id
      WHERE r.org_id = ${orgId}
        AND r.status = 'PROPOSED'
        AND (
          r.insight_id = ${insightId}
          OR (jsonb_typeof(i.payload -> 'evidenceInsightIds') = 'array'
              AND EXISTS (
                SELECT 1 FROM jsonb_array_elements_text(i.payload -> 'evidenceInsightIds') AS e(value)
                -- CASE evaluates in order, so one malformed stored id cannot fail the cast.
                WHERE CASE WHEN e.value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                           THEN e.value::uuid = ${insightId}::uuid
                           ELSE false END))
        )
      FOR UPDATE OF r
    ), closed AS (
      UPDATE iq_recommendations r
      SET status = 'SUPERSEDED', decided_at = now(), updated_at = now()
      FROM affected a
      WHERE r.id = a.id AND r.org_id = ${orgId}
      RETURNING r.id, r.insight_id
    ), retired AS (
      UPDATE iq_insights i
      SET status = 'SUPERSEDED', updated_at = now()
      WHERE i.org_id = ${orgId} AND i.status = 'ACTIVE' AND i.id <> ${insightId}
        AND i.id IN (SELECT insight_id FROM closed)
      RETURNING i.id
    )
    SELECT id FROM closed
  `);
  return rows.map((r) => r.id);
}

/**
 * Stores one claim under the rules in the header. Run it inside a transaction
 * — the job runner's fenced commit — so the claim, any supersede and the
 * chunk's cursor commit together.
 *
 * Two writers racing on the same new dedupe key: the second insert fails on
 * the partial unique index (23505) and its transaction rolls back; chunks are
 * idempotent, so the retry lands as NOOP or UPDATED.
 */
export async function writeInsight(
  tx: IqTx,
  lease: IqWriteLease,
  insight: Insight,
  options: {
    /**
     * Supersede a referenced row even when the content is unchanged. Used only
     * to re-propose a recommendation after its dismissal or expiry cooldown:
     * the closed recommendation holds the old row, so the new one needs a row
     * of its own (RELIABILITY M2).
     */
    readonly replaceIfReferenced?: boolean;
  } = {},
): Promise<WriteInsightResult> {
  await assertLease(tx, lease);
  const claim = await checkWritable(insight, lease);
  const orgId = lease.orgId;

  const [active] = await tx
    .select({ id: iqInsights.id, contentHash: iqInsights.contentHash, referencedAt: iqInsights.referencedAt })
    .from(iqInsights)
    .where(and(eq(iqInsights.orgId, orgId), eq(iqInsights.dedupeKey, claim.dedupeKey), eq(iqInsights.status, "ACTIVE")))
    .for("update");

  if (!active) {
    await tx.insert(iqInsights).values({
      id: claim.id,
      orgId,
      dedupeKey: claim.dedupeKey,
      status: "ACTIVE",
      supersedes: null,
      ...contentColumns(claim, lease),
    });
    return { outcome: "INSERTED", insightId: claim.id };
  }

  const replace = options.replaceIfReferenced === true && active.referencedAt !== null;
  if (active.contentHash === claim.contentHash && !replace) return { outcome: "NOOP", insightId: active.id };
  if (replace && claim.id === active.id) throw new Error("iq-insights: a replacement needs a new insight id");

  if (active.referencedAt === null) {
    await tx
      .update(iqInsights)
      .set({ ...contentColumns(claim, lease), updatedAt: sql`now()` })
      .where(and(eq(iqInsights.id, active.id), eq(iqInsights.orgId, orgId)));
    return { outcome: "UPDATED", insightId: active.id };
  }

  // Referenced: append and supersede. The old row leaves ACTIVE first so the
  // partial unique index admits the new one; superseded_by is DEFERRABLE, so
  // it may point at the row inserted next.
  const supersededRecommendationIds = await supersedeRecommendationsCiting(tx, orgId, active.id);
  await tx
    .update(iqInsights)
    .set({ status: "SUPERSEDED", supersededBy: claim.id, updatedAt: sql`now()` })
    .where(and(eq(iqInsights.id, active.id), eq(iqInsights.orgId, orgId)));
  await tx.insert(iqInsights).values({
    id: claim.id,
    orgId,
    dedupeKey: claim.dedupeKey,
    status: "ACTIVE",
    supersedes: active.id,
    ...contentColumns(claim, lease),
  });
  return { outcome: "SUPERSEDED", insightId: claim.id, supersededInsightId: active.id, supersededRecommendationIds };
}

// ── Reading ────────────────────────────────────────────────────────────────

const StoredClaimSchema = z.discriminatedUnion("claimType", [
  z.object({ claimType: z.literal("FACT"), payload: FactPayloadSchema }),
  z.object({ claimType: z.literal("DETECTION"), payload: DetectionPayloadSchema }),
  z.object({ claimType: z.literal("FORECAST"), payload: ForecastPayloadSchema }),
  z.object({ claimType: z.literal("EXPLANATION"), payload: ExplanationPayloadSchema }),
  z.object({ claimType: z.literal("RECOMMENDATION"), payload: RecommendationPayloadSchema }),
  z.object({ claimType: z.literal("AUTOMATION"), payload: AutomationPayloadSchema }),
]);

/**
 * An insight as the table holds it. The table has no column for the copy
 * template or for trust's metric ids and reasons, so a stored insight is not
 * a full engine `Insight`; its payload and evidence are re-validated against
 * the engine contract on every read.
 */
export type StoredInsight = z.output<typeof StoredClaimSchema> & {
  readonly id: string;
  readonly orgId: string;
  readonly locationId: string | null;
  readonly status: string;
  readonly subject: { readonly kind: string; readonly ref: string };
  readonly period: { readonly start: Date; readonly end: Date };
  readonly dedupeKey: string;
  readonly evidence: readonly Evidence[];
  readonly trust: { readonly state: string; readonly score: number | null; readonly asOf: Date | null };
  readonly contentHash: string;
  readonly supersedes: string | null;
  readonly supersededBy: string | null;
  readonly referencedAt: Date | null;
  readonly expiresAt: Date | null;
  readonly createdAt: Date;
};

export type StoredInsightsRead = {
  readonly insights: readonly StoredInsight[];
  /** Rows that failed the contract or carried personal data: never returned, only counted. */
  readonly dropped: number;
};

type InsightRow = typeof iqInsights.$inferSelect;

function toStoredInsight(row: InsightRow): StoredInsight | null {
  const claim = StoredClaimSchema.safeParse({ claimType: row.claimType, payload: row.payload });
  const evidence = z.array(EvidenceSchema).min(1).safeParse(row.evidence);
  if (!claim.success || !evidence.success) return null;
  if (findPersonalData({ payload: row.payload, evidence: row.evidence }).length > 0) return null;
  return {
    ...claim.data,
    id: row.id,
    orgId: row.orgId,
    locationId: row.locationId,
    status: row.status,
    subject: { kind: row.subjectKind, ref: row.subjectRef },
    period: { start: row.periodStart, end: row.periodEnd },
    dedupeKey: row.dedupeKey,
    evidence: evidence.data,
    trust: { state: row.trustState, score: row.trustScore, asOf: row.trustAsOf },
    contentHash: row.contentHash,
    supersedes: row.supersedes,
    supersededBy: row.supersededBy,
    referencedAt: row.referencedAt,
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
  };
}

/** The org's insights, newest first. ACTIVE only unless statuses say otherwise. */
export async function listInsights(
  orgId: string,
  options: {
    readonly claimTypes?: readonly ClaimType[];
    readonly statuses?: readonly ("ACTIVE" | "SUPERSEDED" | "EXPIRED" | "RETRACTED")[];
    readonly limit?: number;
  } = {},
): Promise<StoredInsightsRead> {
  const statuses = options.statuses ?? ["ACTIVE"];
  const limit = Math.min(Math.max(options.limit ?? 100, 1), 500);
  const rows = await db()
    .select()
    .from(iqInsights)
    .where(
      and(
        eq(iqInsights.orgId, orgId),
        inArray(iqInsights.status, [...statuses]),
        options.claimTypes ? inArray(iqInsights.claimType, [...options.claimTypes]) : undefined,
      ),
    )
    .orderBy(desc(iqInsights.createdAt))
    .limit(limit);

  const insights: StoredInsight[] = [];
  for (const row of rows) {
    const stored = toStoredInsight(row);
    if (stored) insights.push(stored);
  }
  return { insights, dropped: rows.length - insights.length };
}

/** One org-scoped insight by id, or null when it is absent, another org's, or fails the contract. */
export async function getInsight(orgId: string, insightId: string): Promise<StoredInsight | null> {
  const [row] = await db()
    .select()
    .from(iqInsights)
    .where(and(eq(iqInsights.orgId, orgId), eq(iqInsights.id, insightId)));
  return row ? toStoredInsight(row) : null;
}

export type FactFigureRow = {
  readonly insightId: string;
  readonly period: { readonly start: Date; readonly end: Date };
  /** Minted by observed(): this figure was read from a stored FACT row. */
  readonly value: Observed;
};

/**
 * The org's stored ACTIVE FACT figures for one metric, newest period first —
 * what a detector reads as history for its baseline.
 */
export async function readFactFigures(
  orgId: string,
  metricId: string,
  options: { readonly limit?: number } = {},
): Promise<{ readonly figures: readonly FactFigureRow[]; readonly dropped: number }> {
  const limit = Math.min(Math.max(options.limit ?? 60, 1), 400);
  const rows = await db()
    .select({
      id: iqInsights.id,
      periodStart: iqInsights.periodStart,
      periodEnd: iqInsights.periodEnd,
      value: sql<unknown>`${iqInsights.payload} -> 'value'`,
    })
    .from(iqInsights)
    .where(
      and(
        eq(iqInsights.orgId, orgId),
        eq(iqInsights.claimType, "FACT"),
        eq(iqInsights.status, "ACTIVE"),
        sql`${iqInsights.payload} ->> 'metricId' = ${metricId}`,
      ),
    )
    .orderBy(desc(iqInsights.periodStart))
    .limit(limit);

  const figures: FactFigureRow[] = [];
  for (const row of rows) {
    try {
      figures.push({ insightId: row.id, period: { start: row.periodStart, end: row.periodEnd }, value: observed(row.value as Quantity) });
    } catch {
      // A malformed stored figure is dropped and counted, never guessed at.
    }
  }
  return { figures, dropped: rows.length - figures.length };
}
