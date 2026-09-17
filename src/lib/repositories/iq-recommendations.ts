import "server-only";

/**
 * Recommendations — a proposed action and what the owner did with it.
 *
 * hive/reviews/iq-0 DESIGN.md §2 and DESIGN-v2-DELTA.md §2–§4, over 0034.
 *
 * `proposeRecommendation` is the only writer. Before anything is written it
 * refuses an action kind outside the catalog, a tier that disagrees with the
 * catalog, a kind still blocked by an owner decision, and params that are not
 * a flat scalar record or that carry personal data; it computes the params
 * hash itself from canonical params and never trusts a caller's (SECURITY
 * review of ab9c45c, R1/R2). Then, in one fenced transaction, it:
 *   1. takes a transaction advisory lock on (org, action kind, params hash),
 *      so two runs proposing the same action queue instead of both reading
 *      "nothing open" (RELIABILITY S1);
 *   2. refuses a proposal still cooling down after the owner dismissed the
 *      same action (7 days) or let it expire (1 day) — same org, action kind
 *      and params hash, durations from automation/cooldown.ts;
 *   3. refuses one while a different PROPOSED row for the same action is open;
 *   4. locks every evidence insight (org-scoped, in id order) and refuses with
 *      STALE_EVIDENCE unless each is ACTIVE at the content hash the caller
 *      read. A concurrent in-place update or supersede of the evidence then
 *      either waits for this proposal or is seen by it (RELIABILITY M1);
 *   5. writes the RECOMMENDATION insight (iq-insights.ts — NOOP, update, or
 *      supersede, which also closes the PROPOSED row it replaces). When the
 *      identical claim's recommendation was dismissed or expired and the
 *      cooldown has passed, the insight is superseded by a new row so the
 *      recommendation can come back (RELIABILITY M2);
 *   6. inserts the recommendation. The 0034 trigger marks its insight and
 *      every evidence insight referenced in the same transaction, freezing
 *      them. An insert that collides with an open duplicate (23505) is a
 *      NOOP, not an error: the chunk is being retried or another run got there.
 *
 * The recommendation's numbers are copied from the insight payload, never
 * passed separately, so the row and the claim cannot disagree (review A3).
 * Every query filters on org_id itself; the app's role bypasses RLS.
 */

import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { iqInsights, iqRecommendations } from "@/db/schema";
import { catalogEntry, isActionKind } from "@/lib/iq/automation/catalog";
import { COOLDOWN_MS, type CooldownReason } from "@/lib/iq/automation/cooldown";
import { actionParamsHash, magnitudeOf, parseActionParams, type InsightOf } from "@/lib/iq/engine";
import { assertLease, writeInsight, type IqTx, type IqWriteLease } from "./iq-insights";

export type RecommendationStatus = "PROPOSED" | "APPROVED" | "DISMISSED" | "EXPIRED" | "SUPERSEDED";

const CLOSED: readonly RecommendationStatus[] = ["APPROVED", "DISMISSED", "EXPIRED", "SUPERSEDED"];

/** A person said no → a week; nobody looked in time → a day; approved or superseded → none. */
const COOLDOWN: { readonly [S in RecommendationStatus]?: { readonly reason: CooldownReason; readonly ms: number } } = {
  DISMISSED: { reason: "DISMISSED_COOLDOWN", ms: COOLDOWN_MS.dismissed },
  EXPIRED: { reason: "EXPIRED_COOLDOWN", ms: COOLDOWN_MS.expired },
};

export type RecommendationHistory = {
  /** An open PROPOSED row for this action, if any. */
  readonly open: { readonly id: string; readonly dedupeKey: string } | null;
  /** The most recently closed row for this action. */
  readonly latestClosed: { readonly id: string; readonly status: RecommendationStatus; readonly decidedAt: Date } | null;
  /** Database time, so the cooldown never depends on the app server's clock. */
  readonly dbNow: Date;
};

/** The cooldown lookup: open and latest closed recommendation for one org, action kind and params hash. */
export async function recommendationHistory(
  orgId: string,
  actionKind: string,
  paramsHash: string,
  tx: IqTx | ReturnType<typeof db> = db(),
): Promise<RecommendationHistory> {
  const scope = and(
    eq(iqRecommendations.orgId, orgId),
    eq(iqRecommendations.actionKind, actionKind),
    eq(iqRecommendations.paramsHash, paramsHash),
  );
  const [open] = await tx
    .select({ id: iqRecommendations.id, dedupeKey: iqRecommendations.dedupeKey })
    .from(iqRecommendations)
    .where(and(scope, eq(iqRecommendations.status, "PROPOSED")))
    .limit(1);
  const [closed] = await tx
    .select({ id: iqRecommendations.id, status: iqRecommendations.status, decidedAt: iqRecommendations.decidedAt })
    .from(iqRecommendations)
    .where(and(scope, inArray(iqRecommendations.status, [...CLOSED])))
    .orderBy(desc(iqRecommendations.decidedAt))
    .limit(1);
  const [clock] = await tx.execute<{ now: Date | string }>(sql`SELECT clock_timestamp() AS now`);

  return {
    open: open ?? null,
    latestClosed:
      closed && closed.decidedAt
        ? { id: closed.id, status: closed.status as RecommendationStatus, decidedAt: closed.decidedAt }
        : null,
    dbNow: new Date(clock?.now ?? Date.now()),
  };
}

export type ProposeResult =
  | {
      readonly outcome: "PROPOSED";
      readonly recommendationId: string;
      readonly insightId: string;
      readonly paramsHash: string;
      readonly supersededRecommendationIds: readonly string[];
    }
  | { readonly outcome: "NOOP"; readonly insightId: string }
  | { readonly outcome: "OPEN_DUPLICATE"; readonly openRecommendationId: string }
  | { readonly outcome: "COOLDOWN"; readonly reason: CooldownReason; readonly until: Date }
  /** An evidence insight is missing, no longer ACTIVE, or changed since the caller read it. Re-derive and try again. */
  | { readonly outcome: "STALE_EVIDENCE"; readonly insightIds: readonly string[] };

export type ProposeInput = {
  readonly insight: InsightOf<"RECOMMENDATION">;
  /** A flat record of scalars. Its sha256 over canonical JSON is the identity cooldown, duplicates and approval bind to. */
  readonly params: Readonly<Record<string, unknown>>;
  /** Optional: a hash the caller already holds. It is compared with the computed one, never used in its place. */
  readonly expectedParamsHash?: string;
  /** The content hash of every payload.evidenceInsightIds entry, as the caller read it. */
  readonly evidenceContentHashes: Readonly<Record<string, string>>;
};

const REPROPOSABLE: readonly string[] = ["DISMISSED", "EXPIRED"];

/** Locks the evidence rows in id order and returns the ids that are missing, not ACTIVE, or not at the pinned hash. */
async function lockEvidence(tx: IqTx, orgId: string, pins: ReadonlyMap<string, string>): Promise<string[]> {
  const ids = [...pins.keys()].sort();
  if (ids.length === 0) return [];
  const rows = await tx
    .select({ id: iqInsights.id, status: iqInsights.status, contentHash: iqInsights.contentHash })
    .from(iqInsights)
    .where(and(eq(iqInsights.orgId, orgId), inArray(iqInsights.id, ids)))
    .orderBy(iqInsights.id)
    .for("no key update");
  const found = new Map(rows.map((r) => [r.id, r]));
  return ids.filter((id) => {
    const row = found.get(id);
    return !row || row.status !== "ACTIVE" || row.contentHash !== pins.get(id);
  });
}

function isUniqueViolation(error: unknown): boolean {
  const e = error as { code?: string; cause?: { code?: string } };
  return (e.cause?.code ?? e.code) === "23505";
}

export async function proposeRecommendation(tx: IqTx, lease: IqWriteLease, input: ProposeInput): Promise<ProposeResult> {
  await assertLease(tx, lease);
  const { insight } = input;
  if (insight.claimType !== "RECOMMENDATION") throw new Error("iq-recommendations: insight is not a RECOMMENDATION");
  const orgId = lease.orgId;
  const { actionKind } = insight.payload;

  if (!isActionKind(actionKind)) throw new Error(`iq-recommendations: ${actionKind} is not in the action catalog`);
  const entry = catalogEntry(actionKind);
  if (entry.tier !== insight.payload.tier) {
    throw new Error(`iq-recommendations: ${actionKind} is tier ${entry.tier} in the catalog, not ${insight.payload.tier}`);
  }
  if (entry.blockedBy !== null) {
    throw new Error(`iq-recommendations: ${actionKind} cannot be proposed until owner decision ${entry.blockedBy}`);
  }

  let params: ReturnType<typeof parseActionParams>;
  try {
    params = parseActionParams(input.params);
  } catch (error) {
    throw new Error(`iq-recommendations: ${(error as Error).message}`);
  }
  const paramsHash = await actionParamsHash(params);
  if (input.expectedParamsHash !== undefined && input.expectedParamsHash !== paramsHash) {
    throw new Error("iq-recommendations: the caller's params hash does not match the params");
  }

  const pins = new Map<string, string>();
  for (const id of insight.payload.evidenceInsightIds) {
    const pin = input.evidenceContentHashes[id];
    if (pin === undefined) throw new Error("iq-recommendations: evidenceContentHashes must pin every evidence insight");
    pins.set(id.toLowerCase(), pin);
  }

  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`iq_recommendation:${orgId}:${actionKind}:${paramsHash}`}, 0))`);

  const history = await recommendationHistory(orgId, actionKind, paramsHash, tx);
  // An open row under the same dedupe key is this claim's earlier version:
  // writeInsight supersedes it. Under a different key it is a real duplicate.
  if (history.open && history.open.dedupeKey !== insight.dedupeKey) {
    return { outcome: "OPEN_DUPLICATE", openRecommendationId: history.open.id };
  }
  const cooldown = history.latestClosed ? COOLDOWN[history.latestClosed.status] : undefined;
  if (history.latestClosed && cooldown) {
    const until = new Date(history.latestClosed.decidedAt.getTime() + cooldown.ms);
    if (history.dbNow.getTime() < until.getTime()) return { outcome: "COOLDOWN", reason: cooldown.reason, until };
  }

  const stale = await lockEvidence(tx, orgId, pins);
  if (stale.length > 0) return { outcome: "STALE_EVIDENCE", insightIds: stale };

  let written = await writeInsight(tx, lease, insight);
  if (written.outcome === "NOOP") {
    const [existing] = await tx
      .select({ id: iqRecommendations.id, status: iqRecommendations.status })
      .from(iqRecommendations)
      .where(and(eq(iqRecommendations.orgId, orgId), eq(iqRecommendations.insightId, written.insightId)));
    // PROPOSED or APPROVED: the same claim is already in front of the owner or acted on.
    if (existing && !REPROPOSABLE.includes(existing.status)) return { outcome: "NOOP", insightId: written.insightId };
    // Dismissed or expired, and the cooldown above has passed: a fresh row, so a fresh recommendation.
    if (existing) written = await writeInsight(tx, lease, insight, { replaceIfReferenced: true });
  }

  const { impact, confidence, assumptions, tier, expiresAt } = insight.payload;
  try {
    // A savepoint, so a 23505 leaves the caller's transaction usable.
    const [row] = await tx.transaction((sp) =>
      sp
        .insert(iqRecommendations)
        .values({
          orgId,
          locationId: insight.locationId,
          insightId: written.insightId,
          actionKind,
          tier,
          params: { ...params },
          paramsHash,
          impactUnit: impact.low.unit,
          impactLow: magnitudeOf(impact.low),
          impactHigh: magnitudeOf(impact.high),
          confidence: confidence.level,
          assumptions: assumptions as unknown[],
          status: "PROPOSED",
          expiresAt: new Date(expiresAt),
          dedupeKey: insight.dedupeKey,
        })
        .returning({ id: iqRecommendations.id }),
    );
    if (!row) throw new Error("iq-recommendations: insert returned no row");
    return {
      outcome: "PROPOSED",
      recommendationId: row.id,
      insightId: written.insightId,
      paramsHash,
      supersededRecommendationIds: written.supersededRecommendationIds ?? [],
    };
  } catch (error) {
    if (isUniqueViolation(error)) return { outcome: "NOOP", insightId: written.insightId };
    throw error;
  }
}

export type OpenRecommendation = {
  readonly id: string;
  readonly insightId: string;
  readonly actionKind: string;
  readonly tier: string;
  readonly impactUnit: string;
  readonly impactLow: bigint;
  readonly impactHigh: bigint;
  readonly confidence: string;
  readonly expiresAt: Date;
  readonly createdAt: Date;
};

/** The org's PROPOSED recommendations that have not yet expired, soonest expiry first. */
export async function listOpenRecommendations(orgId: string, limit = 50): Promise<readonly OpenRecommendation[]> {
  return db()
    .select({
      id: iqRecommendations.id,
      insightId: iqRecommendations.insightId,
      actionKind: iqRecommendations.actionKind,
      tier: iqRecommendations.tier,
      impactUnit: iqRecommendations.impactUnit,
      impactLow: iqRecommendations.impactLow,
      impactHigh: iqRecommendations.impactHigh,
      confidence: iqRecommendations.confidence,
      expiresAt: iqRecommendations.expiresAt,
      createdAt: iqRecommendations.createdAt,
    })
    .from(iqRecommendations)
    .where(
      and(
        eq(iqRecommendations.orgId, orgId),
        eq(iqRecommendations.status, "PROPOSED"),
        sql`${iqRecommendations.expiresAt} > now()`,
      ),
    )
    .orderBy(iqRecommendations.expiresAt)
    .limit(Math.min(Math.max(limit, 1), 200));
}
