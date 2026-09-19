import "server-only";

/**
 * Idempotency. BUILD-PLAN.md §17.
 *
 * "Do not create duplicate orders because a mobile browser retries a request."
 *
 * The caller supplies a key and an operation. The first call runs the work and
 * stores its result; a replay returns the stored result without running
 * anything. A key reused with a *different* request body is rejected rather
 * than silently answered with the old result — that is a bug in the caller, and
 * quietly returning someone else's order would be worse than an error.
 *
 * Claim first, then work. The previous version looked for a stored result and
 * only wrote one after the work finished, so two identical requests arriving
 * together — a double-tap that beat the button's disabled state, a browser
 * retrying a request it had not given up on — both found nothing and both
 * placed an order. Now the unique (key, operation) row is inserted *before*
 * the work runs: exactly one caller gets it, and everyone else waits for that
 * caller's result instead of doing the work again.
 *
 * Org-scoped (idem-1, SECURITY C1). The unique constraint is (key, operation),
 * with no org, so a key one org used would otherwise replay that org's stored
 * result to another org sending the same body. Every step that reads, releases
 * or completes a row now requires the row's org_id to be the caller's, and the
 * fingerprint covers the org: a key reused by another org is an
 * IdempotencyConflict, never a replay and never an overwrite. Keys are random
 * UUIDs or derived from a UUID row id, so an honest cross-org collision does
 * not happen; refusing one is all this has to do, and needs no migration.
 */

import { and, eq, inArray, isNull, type SQL } from "drizzle-orm";
import { createHash } from "node:crypto";
import { db } from "@/db";
import { idempotencyKeys } from "@/db/schema";

export function fingerprint(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 32);
}

export class IdempotencyConflict extends Error {
  constructor(key: string) {
    super(`idempotency: key "${key}" was already used for a different request`);
    this.name = "IdempotencyConflict";
  }
}

interface Options {
  readonly key: string;
  readonly operation: string;
  /** The org the request acts for. Every caller in the app passes it; a row is only ever read, replayed, released or completed by the same org. */
  readonly orgId?: string;
  /** Hash of the request, so a reused key with new content is caught. */
  readonly request: unknown;
  /** How long a replay keeps returning the stored result. */
  readonly ttlHours?: number;
}

/** How long a second caller waits for the first one's result before assuming it died. */
const IN_FLIGHT_WAIT_MS = 10_000;
const POLL_MS = 250;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The fingerprints a row of this org may carry for this request. The first is
 * what is written. The second is the pre-idem-1 form (request only), still
 * accepted when the row's org_id is the caller's, so a retry of a request
 * stored just before this deployed still replays instead of conflicting. Rows
 * live `ttlHours` (24 by default); the legacy form can go once that has passed.
 */
function fingerprintsFor(orgId: string | undefined, request: unknown): { readonly current: string; readonly accepted: readonly string[] } {
  const legacy = fingerprint(request);
  if (orgId === undefined) return { current: legacy, accepted: [legacy] };
  const current = fingerprint({ orgId, request });
  return { current, accepted: [current, legacy] };
}

/** The row belongs to this caller: same org (or both org-less) and one of this request's fingerprints. */
function ownRow(orgId: string | undefined, accepted: readonly string[]): SQL {
  return and(
    orgId === undefined ? isNull(idempotencyKeys.orgId) : eq(idempotencyKeys.orgId, orgId),
    inArray(idempotencyKeys.requestFingerprint, [...accepted]),
  )!;
}

/**
 * Runs `work` at most once per key.
 *
 * Returns `{ result, replayed }` so a caller can tell a fresh execution from a
 * replay — useful for logging, and for not sending a second confirmation SMS.
 */
export async function withIdempotency<T>(
  { key, operation, orgId, request, ttlHours = 24 }: Options,
  work: () => Promise<T>,
): Promise<{ result: T; replayed: boolean }> {
  const database = db();
  const { current: hash, accepted } = fingerprintsFor(orgId, request);
  const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000);

  const claimed = await database
    .insert(idempotencyKeys)
    .values({ orgId, key, operation, requestFingerprint: hash, expiresAt })
    .onConflictDoNothing({ target: [idempotencyKeys.key, idempotencyKeys.operation] })
    .returning({ id: idempotencyKeys.id });

  if (claimed.length === 0) {
    const stored = await awaitStoredResult<T>(key, operation, orgId, accepted);
    if (stored !== undefined) return { result: stored, replayed: true };
    // The earlier attempt died without a result — this caller takes over.
  }

  const thisRequest = and(eq(idempotencyKeys.key, key), eq(idempotencyKeys.operation, operation), ownRow(orgId, accepted));

  let result: T;
  try {
    result = await work();
  } catch (error) {
    // Release the claim so a retry runs the work instead of waiting on a corpse —
    // only this org's claim for this request, never a row another org took meanwhile.
    await database.delete(idempotencyKeys).where(and(thisRequest, isNull(idempotencyKeys.responseSnapshot)));
    throw error;
  }

  // If another org claimed the key between a takeover and here, setWhere leaves
  // its row alone: the work has run and its result is returned, just not stored.
  await database
    .insert(idempotencyKeys)
    .values({ orgId, key, operation, requestFingerprint: hash, responseSnapshot: result as Record<string, unknown>, expiresAt })
    .onConflictDoUpdate({
      target: [idempotencyKeys.key, idempotencyKeys.operation],
      set: { requestFingerprint: hash, responseSnapshot: result as Record<string, unknown>, expiresAt },
      setWhere: ownRow(orgId, accepted),
    });

  return { result, replayed: false };
}

/**
 * Read-only: has this exact request already been completed?
 *
 * Returns the stored result iff a row exists for this org, operation and key,
 * carries one of this request's fingerprints (the same computation
 * `withIdempotency` uses) and has a stored result. Anything else, including a
 * same-key row with a different fingerprint, another org's row, or an
 * unfinished (in-flight) claim, is null, so the caller's normal flow, and
 * `withIdempotency`'s own conflict handling, are unchanged.
 *
 * Exists so a caller can answer a lost-response retry with the order that
 * already exists before it evaluates rules that only apply to NEW work (opening
 * hours). It inserts, updates and locks nothing.
 */
export async function findIdempotentResult<T>({ key, operation, orgId, request }: Pick<Options, "key" | "operation" | "orgId" | "request">): Promise<T | null> {
  const { accepted } = fingerprintsFor(orgId, request);
  const [row] = await db()
    .select({ responseSnapshot: idempotencyKeys.responseSnapshot })
    .from(idempotencyKeys)
    .where(and(eq(idempotencyKeys.key, key), eq(idempotencyKeys.operation, operation), ownRow(orgId, accepted)))
    .limit(1);
  return row?.responseSnapshot ? (row.responseSnapshot as T) : null;
}

/**
 * Waits for the caller that holds the claim to store its result.
 *
 * Resolves `undefined` when there is nothing to wait for — the claim was
 * released by a failed attempt, or the first caller has been silent for
 * longer than any real request takes — in which case the work should run.
 */
async function awaitStoredResult<T>(key: string, operation: string, orgId: string | undefined, accepted: readonly string[]): Promise<T | undefined> {
  const database = db();
  const deadline = Date.now() + IN_FLIGHT_WAIT_MS;

  for (;;) {
    // Looked up by (key, operation) — the unique key — and not by org, so a row
    // another org holds is seen and refused rather than taken over.
    const [existing] = await database
      .select()
      .from(idempotencyKeys)
      .where(and(eq(idempotencyKeys.key, key), eq(idempotencyKeys.operation, operation)))
      .limit(1);

    if (!existing) return undefined;
    if ((existing.orgId ?? undefined) !== orgId) throw new IdempotencyConflict(key);
    if (existing.requestFingerprint && !accepted.includes(existing.requestFingerprint)) throw new IdempotencyConflict(key);
    if (existing.responseSnapshot) return existing.responseSnapshot as T;
    if (Date.now() > deadline) return undefined;
    await sleep(POLL_MS);
  }
}
