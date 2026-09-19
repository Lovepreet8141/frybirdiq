/**
 * Liveness answer for /api/health: is the app up AND can it reach the
 * database. Pure — the probe is injected so this has no DB import (src/lib
 * rule) and is testable without one.
 *
 * The body is deliberately two fixed strings. No version, commit, schema,
 * host or error text ever leaves this function, because the route is public.
 */
export type HealthResult = { readonly ok: boolean; readonly body: { readonly status: "ok" | "unavailable" } };

export interface HealthDeps {
  /** Resolves if the database answered a trivial query; rejects otherwise. */
  readonly probe: () => Promise<unknown>;
  readonly now: () => number;
  /** Give up on the probe after this long; a hung DB must read as down. */
  readonly timeoutMs: number;
  /** Reuse the last answer this long, so a public URL cannot hammer the DB. */
  readonly cacheMs: number;
}

const DEFAULTS = { timeoutMs: 3000, cacheMs: 5000 } as const;

export function createHealthCheck(deps: Pick<HealthDeps, "probe"> & Partial<HealthDeps>): () => Promise<HealthResult> {
  const { probe } = deps;
  const now = deps.now ?? Date.now;
  const timeoutMs = deps.timeoutMs ?? DEFAULTS.timeoutMs;
  const cacheMs = deps.cacheMs ?? DEFAULTS.cacheMs;

  let cached: { at: number; result: HealthResult } | undefined;
  let inflight: Promise<HealthResult> | undefined;

  const run = async (): Promise<HealthResult> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        probe(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error("timeout")), timeoutMs);
        }),
      ]);
      return { ok: true, body: { status: "ok" } };
    } catch {
      return { ok: false, body: { status: "unavailable" } };
    } finally {
      clearTimeout(timer);
    }
  };

  return async () => {
    if (cached && now() - cached.at < cacheMs) return cached.result;
    // Concurrent callers share one probe rather than each opening a query.
    inflight ??= run().then((result) => {
      cached = { at: now(), result };
      inflight = undefined;
      return result;
    });
    return inflight;
  };
}
