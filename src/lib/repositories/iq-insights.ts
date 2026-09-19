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
 *   - same hash → copy and trust are brought up to date (copy only while
 *     unreferenced; a referenced row's changed copy supersedes), else NOOP;
 *   - different hash, nothing references the row yet → update it in place;
 *   - different hash (or a re-proposal after cooldown), referenced → the old
 *     row becomes SUPERSEDED, a new row supersedes it, and every still-PROPOSED
 *     recommendation that cited the old row is SUPERSEDED with it.
 * The database backs this up: a referenced insight's content and copy are
 * frozen by the 0034/0037 trigger, so a bug here fails loudly.
 *
 * **Time only moves forward** (IQ-2 RELIABILITY C5, U2). Every write and every
 * expiry carries `asOf`, the end of the period or bucket the rule evaluated.
 * It is required — there is no default — and a write or expiry older than the
 * stored as_of is refused with STALE_WRITE, so a slow run can neither
 * overwrite nor expire what a newer run found. A write is also checked
 * against the key's latest row in any status, so it cannot re-fire a finding
 * a newer run already expired.
 *
 * **Payment-ledger findings are finance data** (IQ-2 R2.2). `loadInsightsFor`
 * leaves `recon.*` and `sig.*` producers out of the query unless the viewer
 * holds finance.view — the same producer prefixes 0037's RLS policy uses.
 *
 * Every query filters on org_id itself. The app connects as `postgres`,
 * which bypasses row-level security.
 */

import { and, desc, eq, gt, gte, inArray, like, lt, notLike, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { iqInsights, iqJobRuns } from "@/db/schema";
import { endOfBusinessDay, startOfBusinessDay } from "@/lib/dates";
import {
  InsightSchema,
  IstDateTimeSchema,
  LEDGER_PRODUCER_PREFIXES,
  canonicalJson,
  hasValidContentHash,
  presentFor,
  type ClaimType,
  type Insight,
  type InsightViewer,
  type Observed,
  type Presentation,
  type Quantity,
  type TrustRef,
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

export type WriteInsightOutcome = "INSERTED" | "NOOP" | "UPDATED" | "SUPERSEDED" | "STALE_WRITE";

export type WriteInsightResult = {
  readonly outcome: WriteInsightOutcome;
  /** The stored row that now carries this claim. On UPDATED, NOOP and STALE_WRITE it is the existing row's id. */
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

function trustColumns(trust: TrustRef) {
  return {
    trustState: trust.state,
    trustScore: trust.state === "MEASURED" ? trust.score : null,
    trustAsOf: trust.state === "MEASURED" ? new Date(trust.asOf) : null,
    trustMetricIds: trust.state === "MEASURED" ? [...trust.metricIds] : [],
    trustReasons: trust.state === "NOT_MEASURED" ? [] : [...trust.reasons],
  };
}

function contentColumns(insight: Insight, lease: IqWriteLease, asOf: Date) {
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
    ...trustColumns(insight.trust),
    copy: insight.copy,
    asOf,
    jobRunId: lease.runId,
    jobAttempt: lease.attempt,
    codeVersion: insight.producedBy.codeVersion,
    contentHash: insight.contentHash,
    expiresAt: insight.expiresAt === null ? null : new Date(insight.expiresAt),
  };
}

/** `asOf` is an IST timestamp with an explicit +05:30 offset: the end of what the rule evaluated. */
function parseAsOf(asOf: string): Date {
  return new Date(IstDateTimeSchema.parse(asOf));
}

type TrustColumns = {
  readonly trustState: string;
  readonly trustScore: number | null;
  readonly trustAsOf: Date | null;
  readonly trustMetricIds: readonly string[];
  readonly trustReasons: readonly string[];
};

function sameTrust(a: TrustColumns, b: TrustColumns): boolean {
  return (
    a.trustState === b.trustState &&
    a.trustScore === b.trustScore &&
    (a.trustAsOf?.getTime() ?? null) === (b.trustAsOf?.getTime() ?? null) &&
    canonicalJson(a.trustMetricIds) === canonicalJson(b.trustMetricIds) &&
    canonicalJson(a.trustReasons) === canonicalJson(b.trustReasons)
  );
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

export type WriteInsightOptions = {
  /** End of the period or bucket the rule evaluated (IST, +05:30). Required: there is no default (RELIABILITY U2). */
  readonly asOf: string;
  /**
   * Supersede a referenced row even when the content is unchanged. Used only
   * to re-propose a recommendation after its dismissal or expiry cooldown:
   * the closed recommendation holds the old row, so the new one needs a row
   * of its own (RELIABILITY M2).
   */
  readonly replaceIfReferenced?: boolean;
};

/**
 * Stores one claim under the rules in the header. Run it inside a transaction
 * — the job runner's fenced commit — so the claim, any supersede and the
 * chunk's cursor commit together.
 *
 * Two writers racing on the same new dedupe key: the second insert fails on
 * the partial unique index (23505) and its transaction rolls back; chunks are
 * idempotent, so the retry lands as NOOP or UPDATED.
 */
export async function writeInsight(tx: IqTx, lease: IqWriteLease, insight: Insight, options: WriteInsightOptions): Promise<WriteInsightResult> {
  await assertLease(tx, lease);
  const claim = await checkWritable(insight, lease);
  const asOf = parseAsOf(options.asOf);
  const orgId = lease.orgId;

  const [active] = await tx
    .select({
      id: iqInsights.id,
      contentHash: iqInsights.contentHash,
      referencedAt: iqInsights.referencedAt,
      asOf: iqInsights.asOf,
      copy: iqInsights.copy,
      trustState: iqInsights.trustState,
      trustScore: iqInsights.trustScore,
      trustAsOf: iqInsights.trustAsOf,
      trustMetricIds: iqInsights.trustMetricIds,
      trustReasons: iqInsights.trustReasons,
    })
    .from(iqInsights)
    .where(and(eq(iqInsights.orgId, orgId), eq(iqInsights.dedupeKey, claim.dedupeKey), eq(iqInsights.status, "ACTIVE")))
    .for("update");

  if (!active) {
    // No ACTIVE row may mean a newer run already EXPIRED (or superseded) this key.
    // An older run must not re-fire it: compare with the key's latest as_of in any
    // status (RELIABILITY iq2-s2-rel). Under READ COMMITTED a concurrent expire holds
    // the row lock, so once it commits this statement sees the EXPIRED row.
    const [latest] = await tx
      .select({ id: iqInsights.id, asOf: iqInsights.asOf })
      .from(iqInsights)
      .where(and(eq(iqInsights.orgId, orgId), eq(iqInsights.dedupeKey, claim.dedupeKey)))
      .orderBy(desc(iqInsights.asOf))
      .limit(1);
    if (latest && asOf.getTime() < latest.asOf.getTime()) return { outcome: "STALE_WRITE", insightId: latest.id };

    await tx.insert(iqInsights).values({
      id: claim.id,
      orgId,
      dedupeKey: claim.dedupeKey,
      status: "ACTIVE",
      supersedes: null,
      ...contentColumns(claim, lease, asOf),
    });
    return { outcome: "INSERTED", insightId: claim.id };
  }

  // A run that evaluated older data never overwrites what a newer run stored (C5).
  if (asOf.getTime() < active.asOf.getTime()) return { outcome: "STALE_WRITE", insightId: active.id };

  const replace = options.replaceIfReferenced === true && active.referencedAt !== null;
  if (replace && claim.id === active.id) throw new Error("iq-insights: a replacement needs a new insight id");

  if (active.contentHash === claim.contentHash && !replace) {
    const trust = trustColumns(claim.trust);
    const trustChanged = !sameTrust(trust, active);
    const copyChanged = canonicalJson(active.copy) !== canonicalJson(claim.copy);
    const asOfChanged = asOf.getTime() !== active.asOf.getTime();
    const referenced = active.referencedAt !== null;

    // A referenced row's wording is frozen with its claim: a new wording is a new row (R2.4).
    if (!(referenced && copyChanged)) {
      if (!trustChanged && !copyChanged && !asOfChanged) return { outcome: "NOOP", insightId: active.id };
      await tx
        .update(iqInsights)
        .set({ ...trust, ...(referenced ? {} : { copy: claim.copy }), asOf, updatedAt: sql`now()` })
        .where(and(eq(iqInsights.id, active.id), eq(iqInsights.orgId, orgId)));
      return { outcome: "UPDATED", insightId: active.id };
    }
    if (claim.id === active.id) throw new Error("iq-insights: a new wording on a referenced insight needs a new insight id");
  } else if (active.referencedAt === null) {
    await tx
      .update(iqInsights)
      .set({ ...contentColumns(claim, lease, asOf), updatedAt: sql`now()` })
      .where(and(eq(iqInsights.id, active.id), eq(iqInsights.orgId, orgId)));
    return { outcome: "UPDATED", insightId: active.id };
  }

  // Referenced: append and supersede. The old row leaves ACTIVE first so the
  // partial unique index admits the new one; superseded_by is DEFERRABLE, so
  // it may point at the row inserted next.
  const supersededRecommendationIds = await supersedeRecommendationsCiting(tx, orgId, active.id);
  await tx
    .update(iqInsights)
    .set({ status: "SUPERSEDED", statusReason: "SUPERSEDED", supersededBy: claim.id, updatedAt: sql`now()` })
    .where(and(eq(iqInsights.id, active.id), eq(iqInsights.orgId, orgId)));
  await tx.insert(iqInsights).values({
    id: claim.id,
    orgId,
    dedupeKey: claim.dedupeKey,
    status: "ACTIVE",
    supersedes: active.id,
    ...contentColumns(claim, lease, asOf),
  });
  return { outcome: "SUPERSEDED", insightId: claim.id, supersededInsightId: active.id, supersededRecommendationIds };
}

export type ExpireRequest = {
  readonly dedupeKey: string;
  /** End of the period or bucket whose evaluation found the rule clear (IST, +05:30). */
  readonly asOf: string;
  readonly reason: "CLEARED" | "CLOSING_TIME";
};

export type ExpireInsightsResult = {
  readonly expired: number;
  readonly expiredIds: readonly string[];
  /** Keys whose stored as_of is newer than the request: left ACTIVE (C5). */
  readonly staleWrites: number;
  /** Keys with no ACTIVE row. */
  readonly absent: number;
  readonly supersededRecommendationIds: readonly string[];
};

/**
 * Expires the org's ACTIVE insights for keys a committed chunk evaluated and
 * found clear. Pass only those keys: a rule that did not evaluate (not enough
 * history, low trust, stale input, a timeout, or a date past a PARTIAL run's
 * cursor) must never be expired (RELIABILITY C6).
 *
 * Each expiry is a compare-and-set on (id, as_of) inside the caller's fenced
 * chunk: an older request than the stored as_of is refused as a stale write.
 * A referenced insight takes the supersede path first — the PROPOSED
 * recommendations resting on it are closed — then expires.
 */
export async function expireInsights(tx: IqTx, lease: IqWriteLease, requests: readonly ExpireRequest[]): Promise<ExpireInsightsResult> {
  await assertLease(tx, lease);
  const orgId = lease.orgId;
  const result = { expired: 0, expiredIds: [] as string[], staleWrites: 0, absent: 0, supersededRecommendationIds: [] as string[] };

  for (const request of requests) {
    const asOf = parseAsOf(request.asOf);
    const [active] = await tx
      .select({ id: iqInsights.id, asOf: iqInsights.asOf, referencedAt: iqInsights.referencedAt })
      .from(iqInsights)
      .where(and(eq(iqInsights.orgId, orgId), eq(iqInsights.dedupeKey, request.dedupeKey), eq(iqInsights.status, "ACTIVE")))
      .for("update");
    if (!active) {
      result.absent += 1;
      continue;
    }
    if (asOf.getTime() < active.asOf.getTime()) {
      result.staleWrites += 1;
      continue;
    }
    if (active.referencedAt !== null) {
      result.supersededRecommendationIds.push(...(await supersedeRecommendationsCiting(tx, orgId, active.id)));
    }
    const updated = await tx
      .update(iqInsights)
      .set({ status: "EXPIRED", statusReason: request.reason, asOf, updatedAt: sql`now()` })
      .where(
        and(
          eq(iqInsights.id, active.id),
          eq(iqInsights.orgId, orgId),
          eq(iqInsights.status, "ACTIVE"),
          sql`${iqInsights.asOf} <= ${asOf.toISOString()}::timestamptz`,
        ),
      )
      .returning({ id: iqInsights.id });
    if (updated.length === 1) {
      result.expired += 1;
      result.expiredIds.push(active.id);
    } else {
      result.staleWrites += 1;
    }
  }
  return result;
}

// ── Reading ────────────────────────────────────────────────────────────────

/**
 * An engine `Insight` read back from its row, with the storage facts the
 * brief and the expiry guard need. The insight part re-parses through
 * `InsightSchema` (strict shapes, content rules, personal-data ban) on every
 * read, so it can go straight to `present()`.
 */
export type StoredInsight = Insight & {
  readonly asOf: Date;
  readonly statusReason: string | null;
  readonly referencedAt: Date | null;
  readonly supersededBy: string | null;
};

export type StoredInsightsRead = {
  readonly insights: readonly StoredInsight[];
  /** Rows that failed the contract or carried personal data: never returned, only counted. */
  readonly dropped: number;
};

type InsightRow = typeof iqInsights.$inferSelect;

/** A stored instant as the engine's IST timestamp: `2026-09-11T00:00:00+05:30`, milliseconds only when present. */
export function istTimestamp(at: Date): string {
  const shifted = new Date(at.getTime() + 330 * 60_000).toISOString();
  const withoutZone = shifted.endsWith(".000Z") ? shifted.slice(0, 19) : shifted.slice(0, 23);
  return `${withoutZone}+05:30`;
}

function trustRefOf(row: InsightRow): unknown {
  switch (row.trustState) {
    case "MEASURED":
      return {
        state: "MEASURED",
        score: row.trustScore,
        asOf: row.trustAsOf ? istTimestamp(row.trustAsOf) : null,
        metricIds: row.trustMetricIds,
        reasons: row.trustReasons,
      };
    case "INSUFFICIENT_DATA":
      return { state: "INSUFFICIENT_DATA", reasons: row.trustReasons };
    default:
      return { state: row.trustState };
  }
}

/**
 * Rebuilds the Insight. `producedBy.job` is not a column: it is the job of
 * the run that wrote the row. A row whose run was pruned has no job to name
 * and fails the contract — dropped and counted, never guessed.
 */
function toStoredInsight(row: InsightRow, job: string | null): StoredInsight | null {
  const parsed = InsightSchema.safeParse({
    id: row.id,
    orgId: row.orgId,
    locationId: row.locationId,
    schemaVersion: row.schemaVersion,
    producer: row.producer,
    subject: { kind: row.subjectKind, ref: row.subjectRef },
    period: { start: istTimestamp(row.periodStart), end: istTimestamp(row.periodEnd) },
    dedupeKey: row.dedupeKey,
    evidence: row.evidence,
    trust: trustRefOf(row),
    copy: row.copy,
    status: row.status,
    producedBy: { job, runId: row.jobRunId, attempt: row.jobAttempt, codeVersion: row.codeVersion },
    contentHash: row.contentHash,
    supersedes: row.supersedes,
    createdAt: istTimestamp(row.createdAt),
    expiresAt: row.expiresAt ? istTimestamp(row.expiresAt) : null,
    claimType: row.claimType,
    payload: row.payload,
  });
  if (!parsed.success) return null;
  return { ...parsed.data, asOf: row.asOf, statusReason: row.statusReason, referencedAt: row.referencedAt, supersededBy: row.supersededBy };
}

type Statuses = readonly ("ACTIVE" | "SUPERSEDED" | "EXPIRED" | "RETRACTED")[];

async function readRows(
  orgId: string,
  options: {
    readonly claimTypes?: readonly ClaimType[];
    readonly statuses?: Statuses;
    readonly limit?: number;
    readonly includeLedger: boolean;
    /** An extra org-scoped condition (the brief's day window); ANDed with the rest. */
    readonly where?: SQL;
  },
): Promise<StoredInsightsRead> {
  const statuses = options.statuses ?? ["ACTIVE"];
  const limit = Math.min(Math.max(options.limit ?? 100, 1), 500);
  const rows = await db()
    .select({ row: iqInsights, job: iqJobRuns.job })
    .from(iqInsights)
    .leftJoin(iqJobRuns, and(eq(iqJobRuns.id, iqInsights.jobRunId), eq(iqJobRuns.orgId, iqInsights.orgId)))
    .where(
      and(
        eq(iqInsights.orgId, orgId),
        inArray(iqInsights.status, [...statuses]),
        options.claimTypes ? inArray(iqInsights.claimType, [...options.claimTypes]) : undefined,
        options.where,
        ...(options.includeLedger ? [] : LEDGER_PRODUCER_PREFIXES.map((prefix) => notLike(iqInsights.producer, `${prefix}%`))),
      ),
    )
    .orderBy(desc(iqInsights.createdAt))
    .limit(limit);

  const insights: StoredInsight[] = [];
  for (const { row, job } of rows) {
    const stored = toStoredInsight(row, job);
    if (stored) insights.push(stored);
  }
  return { insights, dropped: rows.length - insights.length };
}

/**
 * The org's insights, newest first, ACTIVE only unless statuses say otherwise.
 * For jobs and internal reads: it includes payment-ledger findings. Anything
 * that renders for a person goes through `loadInsightsFor`.
 */
export async function listInsights(
  orgId: string,
  options: { readonly claimTypes?: readonly ClaimType[]; readonly statuses?: Statuses; readonly limit?: number } = {},
): Promise<StoredInsightsRead> {
  return readRows(orgId, { ...options, includeLedger: true });
}

/** One org-scoped insight by id, or null when it is absent, another org's, or fails the contract. */
export async function getInsight(orgId: string, insightId: string): Promise<StoredInsight | null> {
  const [found] = await db()
    .select({ row: iqInsights, job: iqJobRuns.job })
    .from(iqInsights)
    .leftJoin(iqJobRuns, and(eq(iqJobRuns.id, iqInsights.jobRunId), eq(iqJobRuns.orgId, iqInsights.orgId)))
    .where(and(eq(iqInsights.orgId, orgId), eq(iqInsights.id, insightId)));
  return found ? toStoredInsight(found.row, found.job) : null;
}

export type PresentedInsight = {
  readonly presentation: Presentation;
  readonly status: StoredInsight["status"];
  readonly statusReason: string | null;
  readonly asOf: Date;
};

export type InsightsForViewer = {
  readonly items: readonly PresentedInsight[];
  /**
   * True whenever the viewer lacks finance.view — whether or not any
   * payment-ledger finding exists — so the page can say "restricted" without
   * revealing a count, or even that there is something to hide (R2.2).
   */
  readonly restricted: boolean;
  readonly dropped: number;
};

/**
 * What a person may see: payment-ledger findings (`recon.*`, `sig.*`) are
 * left out of the query itself without finance.view, then every row is
 * rendered through `presentFor`, which applies the same rule again.
 */
export async function loadInsightsFor(
  orgId: string,
  viewer: InsightViewer,
  options: { readonly claimTypes?: readonly ClaimType[]; readonly statuses?: Statuses; readonly limit?: number } = {},
): Promise<InsightsForViewer> {
  const read = await readRows(orgId, { ...options, includeLedger: viewer.financeView });
  const presented = presentFor(read.insights, viewer);
  const byId = new Map(read.insights.map((i) => [i.id, i]));
  return {
    items: presented.items.map((presentation) => {
      const stored = byId.get(presentation.insightId)!;
      return { presentation, status: stored.status, statusReason: stored.statusReason, asOf: stored.asOf };
    }),
    restricted: presented.restricted,
    dropped: read.dropped,
  };
}

/**
 * Every insight the daily brief for one IST business day may need, as stored
 * rows — not presentations (IQ-2 R2.10, BUSINESS-INTELLIGENCE's S10 request).
 *
 * `composeBrief` needs `period`, `producer`, `dedupeKey`, `createdAt`,
 * `statusReason` and `supersededBy` to pick the day's set, so it takes
 * `StoredInsight`, not `Presentation`. The gate is the same as
 * `loadInsightsFor`: without finance.view the `recon.*` and `sig.*` producers
 * never leave the query, and `composeBrief` runs `presentFor` over the result
 * again, so a viewer cannot reach a payment-ledger finding either way.
 *
 * The window is a **superset** of what `composeBrief.isForDay` keeps — the
 * selection rule is the brief's, not the repository's:
 *  - rows whose period starts inside the day (the detections and the day's facts);
 *  - payment-ledger rows overlapping the day, or still ACTIVE and opened before
 *    its end (`sig.*` keeps one key per rule and looks back 48 h);
 *  - rows whose dedupe key ends `:<date>` — the brief's own FACTs for the day,
 *    including the two month-to-date windows, whose periods are not the day.
 *
 * FACT and DETECTION only, RETRACTED never: the brief ignores everything else.
 */
export async function loadBriefInsightsFor(
  orgId: string,
  viewer: InsightViewer,
  date: string,
  options: { readonly limit?: number } = {},
): Promise<StoredInsightsRead> {
  const dayStart = startOfBusinessDay(date);
  const dayEnd = endOfBusinessDay(date);
  const ledgerOverlap = LEDGER_PRODUCER_PREFIXES.map((prefix) => like(iqInsights.producer, `${prefix}%`));
  return readRows(orgId, {
    claimTypes: ["FACT", "DETECTION"],
    statuses: ["ACTIVE", "SUPERSEDED", "EXPIRED"],
    limit: options.limit ?? 500,
    includeLedger: viewer.financeView,
    where: or(
      and(gte(iqInsights.periodStart, dayStart), lt(iqInsights.periodStart, dayEnd)),
      and(
        or(...ledgerOverlap),
        lt(iqInsights.periodStart, dayEnd),
        or(eq(iqInsights.status, "ACTIVE"), gt(iqInsights.periodEnd, dayStart)),
      ),
      like(iqInsights.dedupeKey, `%:${date}`),
    ),
  });
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
