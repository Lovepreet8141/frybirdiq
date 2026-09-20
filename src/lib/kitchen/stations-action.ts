"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { NotPermitted, NotSignedIn, requirePermission } from "@/lib/auth";
import { STATIONS, type StationOrder } from "@/lib/kitchen/stations";
import { loadStationOrders, markOrderReadyFromExpo, setLineDone } from "@/lib/repositories/kitchen-stations";

/**
 * Server actions for the station screens and EXPO (roadmap 4.2). Reading is
 * `kitchen.view`; every change is `kitchen.update`, re-checked here on each
 * call — a screen showing a button authorises nothing (§41). Org comes from
 * the session, never from the request.
 */

export interface StationActionResult {
  readonly ok: boolean;
  readonly error?: string;
}

function explain(error: unknown): StationActionResult {
  if (error instanceof NotSignedIn) return { ok: false, error: "You've been signed out. Sign in again." };
  if (error instanceof NotPermitted) return { ok: false, error: "You don't have permission to do that." };
  throw error;
}

export async function pollStationOrders(): Promise<{ orders: readonly StationOrder[] }> {
  let staff;
  try {
    staff = await requirePermission("kitchen.view");
  } catch {
    return { orders: [] };
  }
  return { orders: await loadStationOrders(staff.orgId) };
}

const lineSchema = z.object({
  orderItemId: z.uuid(),
  done: z.boolean(),
  /** Set by a station screen; absent from EXPO. */
  station: z.enum(STATIONS).optional(),
});

export async function setLineDoneAction(input: unknown): Promise<StationActionResult> {
  const parsed = lineSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "That change could not be applied." };
  try {
    const staff = await requirePermission("kitchen.update");
    const result = await setLineDone({ orgId: staff.orgId, orderItemId: parsed.data.orderItemId, done: parsed.data.done, actorUserId: staff.userId, onlyStation: parsed.data.station });
    return result;
  } catch (error) {
    return explain(error);
  }
}

const readySchema = z.object({ orderId: z.uuid() });

export async function markOrderReadyAction(input: unknown): Promise<StationActionResult> {
  const parsed = readySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "That change could not be applied." };
  try {
    const staff = await requirePermission("kitchen.update");
    const result = await markOrderReadyFromExpo({ orgId: staff.orgId, orderId: parsed.data.orderId, actorUserId: staff.userId });
    revalidatePath("/app/orders");
    return result;
  } catch (error) {
    return explain(error);
  }
}
