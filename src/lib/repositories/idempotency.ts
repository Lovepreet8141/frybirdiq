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
 */

import { and, eq, isNull } from "drizzle-orm";
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
  const hash = fingerprint(request);
  const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000);

  const claimed = await database
    .insert(idempotencyKeys)
    .values({ orgId, key, operation, requestFingerprint: hash, expiresAt })
    .onConflictDoNothing({ target: [idempotencyKeys.key, idempotencyKeys.operation] })
    .returning({ id: idempotencyKeys.id });

  if (claimed.length === 0) {
    const stored = await awaitStoredResult<T>(key, operation, hash);
    if (stored !== undefined) return { result: stored, replayed: true };
    // The earlier attempt died without a result — this caller takes over.
  }

  let result: T;
  try {
    result = await work();
  } catch (error) {
    // Release the claim so a retry runs the work instead of waiting on a corpse.
    await database
      .delete(idempotencyKeys)
      .where(and(eq(idempotencyKeys.key, key), eq(idempotencyKeys.operation, operation), isNull(idempotencyKeys.responseSnapshot)));
    throw error;
  }

  await database
    .insert(idempotencyKeys)
    .values({ orgId, key, operation, requestFingerprint: hash, responseSnapshot: result as Record<string, unknown>, expiresAt })
    .onConflictDoUpdate({
      target: [idempotencyKeys.key, idempotencyKeys.operation],
      set: { responseSnapshot: result as Record<string, unknown>, expiresAt },
    });

  return { result, replayed: false };
}

/**
 * Waits for the caller that holds the claim to store its result.
 *
 * Resolves `undefined` when there is nothing to wait for — the claim was
 * released by a failed attempt, or the first caller has been silent for
 * longer than any real request takes — in which case the work should run.
 */
async function awaitStoredResult<T>(key: string, operation: string, hash: string): Promise<T | undefined> {
  const database = db();
  const deadline = Date.now() + IN_FLIGHT_WAIT_MS;

  for (;;) {
    const [existing] = await database
      .select()
      .from(idempotencyKeys)
      .where(and(eq(idempotencyKeys.key, key), eq(idempotencyKeys.operation, operation)))
      .limit(1);

    if (!existing) return undefined;
    if (existing.requestFingerprint && existing.requestFingerprint !== hash) throw new IdempotencyConflict(key);
    if (existing.responseSnapshot) return existing.responseSnapshot as T;
    if (Date.now() > deadline) return undefined;
    await sleep(POLL_MS);
  }
}
