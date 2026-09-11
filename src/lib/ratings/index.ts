import "server-only";

import { avg, count, eq } from "drizzle-orm";

import { db } from "@/db";
import { orderRatings } from "@/db/schema";

/** The score already left for an order, if any. */
export async function getRating(orderId: string): Promise<number | null> {
  const [row] = await db()
    .select({ score: orderRatings.score })
    .from(orderRatings)
    .where(eq(orderRatings.orderId, orderId))
    .limit(1);
  return row?.score ?? null;
}

export interface RatingSummary {
  readonly average: number;
  readonly count: number;
}

/**
 * The org's average score.
 *
 * Null below a floor of five ratings. An average of one is not an average, and
 * "5.0 from 1 review" is the kind of number that reads as either a mistake or
 * a fake — better to show nothing until there is something to show.
 */
export async function getRatingSummary(orgId: string): Promise<RatingSummary | null> {
  const [row] = await db()
    .select({ average: avg(orderRatings.score), total: count() })
    .from(orderRatings)
    .where(eq(orderRatings.orgId, orgId));

  if (!row || row.total < 5 || row.average === null) return null;
  return { average: Math.round(Number(row.average) * 10) / 10, count: row.total };
}
