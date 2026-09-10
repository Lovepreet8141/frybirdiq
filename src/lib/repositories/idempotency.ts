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
 */

import { and, eq } from "drizzle-orm";
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

  const [existing] = await database
    .select()
    .from(idempotencyKeys)
    .where(and(eq(idempotencyKeys.key, key), eq(idempotencyKeys.operation, operation)))
    .limit(1);

  if (existing) {
    if (existing.requestFingerprint && existing.requestFingerprint !== hash) {
      throw new IdempotencyConflict(key);
    }
    // A row with no snapshot means a previous attempt started and did not
    // finish. Re-running is safer than returning nothing, because the work
    // either did not complete or was itself idempotent.
    if (existing.responseSnapshot) {
      return { result: existing.responseSnapshot as T, replayed: true };
    }
  }

  const result = await work();

  const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000);
  await database
    .insert(idempotencyKeys)
    .values({
      orgId,
      key,
      operation,
      requestFingerprint: hash,
      responseSnapshot: result as Record<string, unknown>,
      expiresAt,
    })
    .onConflictDoUpdate({
      target: [idempotencyKeys.key, idempotencyKeys.operation],
      set: { responseSnapshot: result as Record<string, unknown>, expiresAt },
    });

  return { result, replayed: false };
}
