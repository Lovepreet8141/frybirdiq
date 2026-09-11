/**
 * Resolving product availability. Menu Manager spec.
 *
 * A product can carry several `product_availability` rows — one for every
 * location/channel combination staff have set an exception for, plus
 * wildcard rows (`locationId`/`channel` both null) that apply everywhere. At
 * read time exactly one status has to win for "this product, at this
 * location, on this channel, right now" — that decision is made here, pure
 * and tested, the same way `order-status.ts` and `order-channel.ts` keep
 * lifecycle and channel rules out of the repository layer.
 *
 * Nothing here infers availability from stock. SOLD_OUT_TODAY and
 * TEMPORARILY_UNAVAILABLE are set by a person; this module only decides
 * which already-set row applies and whether a time-bounded one has expired.
 */

export const AVAILABILITY_STATUSES = [
  "AVAILABLE",
  "TEMPORARILY_UNAVAILABLE",
  "SOLD_OUT_TODAY",
  "SCHEDULED_UNAVAILABLE",
] as const;

export type AvailabilityStatus = (typeof AVAILABILITY_STATUSES)[number];

export interface AvailabilityRow {
  readonly locationId: string | null;
  readonly channel: string | null;
  readonly status: AvailabilityStatus;
  readonly unavailableUntil: Date | null;
  readonly reason: string | null;
  /**
   * The business date this row's status was last set on — only meaningful
   * for SOLD_OUT_TODAY, which expires the day after. Every other status
   * ignores it, so callers not exercising that path may pass null.
   */
  readonly setOnBusinessDate: string | null;
}

export interface ResolvedAvailability {
  readonly status: AvailabilityStatus;
  readonly available: boolean;
  readonly reason: string | null;
  /** When status is SCHEDULED_UNAVAILABLE, when it lifts. */
  readonly until: Date | null;
}

const AVAILABLE_EVERYWHERE: ResolvedAvailability = { status: "AVAILABLE", available: true, reason: null, until: null };

/**
 * Which row applies, most specific first: a row scoped to both this
 * location and this channel beats one scoped to only one of them, which
 * beats the fully-wildcard row. A row scoped to a *different* location or
 * channel never matches at all — it is a fact about somewhere else.
 */
function bestMatch(
  rows: readonly AvailabilityRow[],
  locationId: string | null,
  channel: string | null,
): AvailabilityRow | null {
  const candidates = rows.filter(
    (row) =>
      (row.locationId === null || row.locationId === locationId) &&
      (row.channel === null || row.channel === channel),
  );
  if (candidates.length === 0) return null;

  function specificity(row: AvailabilityRow): number {
    return (row.locationId !== null ? 2 : 0) + (row.channel !== null ? 1 : 0);
  }

  return candidates.reduce((best, row) => (specificity(row) > specificity(best) ? row : best));
}

/**
 * Resolves what a product's availability actually is right now.
 *
 * `businessDate` compares are done by the caller passing the row's business
 * date alongside `now`'s — this function only needs `now` to decide whether
 * a SCHEDULED_UNAVAILABLE window has ended and whether a SOLD_OUT_TODAY row
 * set on an earlier business date has rolled over. `soldOutBusinessDate` is
 * the business date the SOLD_OUT_TODAY row was last set on (its
 * `updatedAt`, translated by the caller); passing null skips that check
 * (used by pure unit tests that only care about the SCHEDULED_UNAVAILABLE
 * path).
 */
export function resolveAvailability(
  rows: readonly AvailabilityRow[],
  input: {
    readonly locationId: string | null;
    readonly channel: string | null;
    readonly now: Date;
    /** The business date "today" is, in the row's timezone — compared against a SOLD_OUT_TODAY row's `setOnBusinessDate`. */
    readonly today: string;
  },
): ResolvedAvailability {
  const match = bestMatch(rows, input.locationId, input.channel);
  if (!match) return AVAILABLE_EVERYWHERE;

  switch (match.status) {
    case "AVAILABLE":
      return { status: "AVAILABLE", available: true, reason: null, until: null };

    case "TEMPORARILY_UNAVAILABLE":
      return { status: "TEMPORARILY_UNAVAILABLE", available: false, reason: match.reason, until: null };

    case "SOLD_OUT_TODAY": {
      // Expires at the next business-date rollover — a "sold out" flag set
      // yesterday must not silently carry into today.
      if (match.setOnBusinessDate && match.setOnBusinessDate !== input.today) return AVAILABLE_EVERYWHERE;
      return { status: "SOLD_OUT_TODAY", available: false, reason: match.reason, until: null };
    }

    case "SCHEDULED_UNAVAILABLE": {
      if (match.unavailableUntil && match.unavailableUntil.getTime() <= input.now.getTime()) return AVAILABLE_EVERYWHERE;
      return { status: "SCHEDULED_UNAVAILABLE", available: false, reason: match.reason, until: match.unavailableUntil };
    }
  }
}
