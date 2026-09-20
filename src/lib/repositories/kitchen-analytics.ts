import "server-only";

/**
 * Kitchen analytics reads (roadmap 4.4). Read-only; facts from `order_events`.
 *
 * The window is by the READY event: orders marked READY inside the range, with
 * their first ACCEPTED event looked up regardless of when it happened, so an
 * order accepted at 23:55 and readied at 00:10 is counted on the day it went
 * out. Every query filters `org_id` itself, on events, orders, items and
 * products. All arithmetic is in `src/lib/kitchen/analytics.ts`.
 */

import { and, eq, gte, inArray, lt } from "drizzle-orm";

import { db } from "@/db";
import { orderEvents, orderItems, products } from "@/db/schema";
import type { DateRange } from "@/lib/dates";
import { type HourRow, type LineFact, type PrepSample, type ProductRow, type Summary, prepSamples, summarise, summariseByHour, summariseByProduct } from "@/lib/kitchen/analytics";

export interface KitchenAnalytics {
  readonly range: DateRange;
  /** Null when no order was marked READY in the window: no data, not 0. */
  readonly overall: Summary | null;
  readonly products: readonly ProductRow[];
  readonly hours: readonly HourRow[];
}

export async function getKitchenAnalytics(orgId: string, range: DateRange): Promise<KitchenAnalytics> {
  const database = db();

  const readyEvents = await database
    .select({ orderId: orderEvents.orderId, toStatus: orderEvents.toStatus, at: orderEvents.createdAt })
    .from(orderEvents)
    .where(and(eq(orderEvents.orgId, orgId), eq(orderEvents.toStatus, "READY"), gte(orderEvents.createdAt, range.from), lt(orderEvents.createdAt, range.to)));
  const orderIds = [...new Set(readyEvents.map((event) => event.orderId))];
  if (orderIds.length === 0) return { range, overall: null, products: [], hours: [] };

  const acceptedEvents = await database
    .select({ orderId: orderEvents.orderId, toStatus: orderEvents.toStatus, at: orderEvents.createdAt })
    .from(orderEvents)
    .where(and(eq(orderEvents.orgId, orgId), eq(orderEvents.toStatus, "ACCEPTED"), inArray(orderEvents.orderId, orderIds)));

  const samples: readonly PrepSample[] = prepSamples([...acceptedEvents, ...readyEvents]);
  if (samples.length === 0) return { range, overall: null, products: [], hours: [] };

  const sampled = samples.map((sample) => sample.orderId);
  const lineRows = await database
    .select({ orderId: orderItems.orderId, productId: orderItems.productId, name: orderItems.productName, target: products.prepMinutes })
    .from(orderItems)
    .leftJoin(products, and(eq(products.id, orderItems.productId), eq(products.orgId, orgId)))
    .where(and(eq(orderItems.orgId, orgId), inArray(orderItems.orderId, sampled)));
  const lines: LineFact[] = lineRows.map((row) => ({ orderId: row.orderId, productKey: row.productId ?? `name:${row.name}`, productName: row.name, targetMinutes: row.target }));

  return {
    range,
    overall: summarise(samples.map((sample) => sample.seconds)),
    products: summariseByProduct(samples, lines),
    hours: summariseByHour(samples),
  };
}
