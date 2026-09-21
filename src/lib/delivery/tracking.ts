/**
 * Rider live position: the rules, with no database and no React.
 *
 * A rider's browser posts a GPS fix about every 15 seconds while a delivery is out; the customer's tracking page shows the
 * newest one on a map. Fixes are kept 24 hours and then deleted. The customer only ever sees the newest fix of their own
 * order, only while it is out for delivery, and a fix older than `POSITION_STALE_MS` is shown as "not available right now",
 * never as if it were live (BUILD-PLAN §62: do not fake live location).
 */
import { z } from "zod";
import { toMicro } from "./index";

/** How often the rider's browser sends a fix. */
export const POSITION_POST_INTERVAL_MS = 15_000;
/** The server ignores a fix that arrives sooner than this after the previous one for the same delivery (a retry, a second tab). */
export const POSITION_MIN_GAP_MS = 5_000;
/** A fix older than this is not "where the rider is now". Six missed posts. */
export const POSITION_STALE_MS = 90_000;
/** Fixes are deleted once they are this old. */
export const POSITION_RETENTION_MS = 24 * 60 * 60_000;
/** Accuracy above this many metres is stored as unknown rather than trusted. */
const ACCURACY_CEILING_METRES = 100_000;

const positionSchema = z.object({
  lat: z.number().finite().min(-90).max(90),
  lng: z.number().finite().min(-180).max(180),
  accuracyMetres: z.number().finite().min(0).nullish(),
});

export type ParsedPosition =
  | { readonly ok: true; readonly latMicro: number; readonly lngMicro: number; readonly accuracyMetres: number | null }
  | { readonly ok: false; readonly error: string };

/** Validates one browser fix and converts it to the integer microdegrees the database stores. */
export function parsePosition(input: unknown): ParsedPosition {
  const parsed = positionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "That location could not be read." };
  const { lat, lng, accuracyMetres } = parsed.data;
  // Exactly 0,0 is what a device reports when it has no fix at all, and it is in the sea.
  if (lat === 0 && lng === 0) return { ok: false, error: "That location could not be read." };
  const accuracy = accuracyMetres === null || accuracyMetres === undefined || accuracyMetres > ACCURACY_CEILING_METRES ? null : Math.round(accuracyMetres);
  return { ok: true, latMicro: toMicro(lat), lngMicro: toMicro(lng), accuracyMetres: accuracy };
}

export type Freshness = { readonly fresh: boolean; readonly ageSeconds: number };

/** Whether a fix recorded at `recordedAt` still counts as live at `now`. A fix from the future (clock skew) is treated as brand new. */
export function positionFreshness(recordedAt: Date, now: Date): Freshness {
  const ageMs = Math.max(0, now.getTime() - recordedAt.getTime());
  return { fresh: ageMs <= POSITION_STALE_MS, ageSeconds: Math.floor(ageMs / 1000) };
}

/** The cutoff before which fixes are deleted. */
export function retentionCutoff(now: Date): Date {
  return new Date(now.getTime() - POSITION_RETENTION_MS);
}

/** What the customer's page shows for the rider, from the newest fix and the order state. */
export type TrackerState =
  | { readonly kind: "hidden" }
  | { readonly kind: "waiting" }
  | { readonly kind: "stale"; readonly ageSeconds: number }
  | { readonly kind: "live"; readonly ageSeconds: number };

export function trackerState(input: { readonly outForDelivery: boolean; readonly latest: { readonly recordedAt: Date } | null; readonly now: Date }): TrackerState {
  if (!input.outForDelivery) return { kind: "hidden" };
  if (!input.latest) return { kind: "waiting" };
  const { fresh, ageSeconds } = positionFreshness(input.latest.recordedAt, input.now);
  return fresh ? { kind: "live", ageSeconds } : { kind: "stale", ageSeconds };
}
