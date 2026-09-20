/**
 * Kitchen tickets — what the KDS shows, derived from active orders.
 *
 * Pure. No station, no routing: the domain has no such concept yet and
 * inventing one is an architectural decision, not a mapping. What it does
 * have is `isLiveInKitchen` (§21) and the timestamps the kitchen actually
 * works to, and that is all this uses.
 *
 * Deliberately carries no money and no phone number — a ticket is not a
 * bill, the same rule `KotOrder` already follows.
 */

import { type FulfilmentType, type OrderStatus, isLiveInKitchen } from "@/domain/order-status";

export type KitchenStatus = "ACCEPTED" | "PREPARING" | "READY";

export interface KitchenTicket {
  readonly id: string;
  readonly orderNumber: string;
  readonly status: KitchenStatus;
  readonly fulfilment: FulfilmentType;
  readonly tableName: string | null;
  readonly customerName: string | null;
  readonly notes: string | null;
  readonly items: readonly { name: string; quantity: number; modifiers: readonly string[] }[];
  /** ISO. When the customer placed it — the clock the kitchen is judged against. */
  readonly placedAt: string | null;
  /** ISO. The time the counter promised at accept; null if none was set. */
  readonly promisedAt: string | null;
  /**
   * Minutes the slowest line on the ticket is expected to take (roadmap 4.1):
   * the max of `products.prep_minutes` over its lines. Null when no line has a
   * target configured — there is deliberately no default, so an unset menu
   * shows no amber or red rather than an invented one.
   */
  readonly prepTargetMinutes: number | null;
}

export interface KitchenSource {
  readonly id: string;
  readonly orderNumber: string;
  readonly status: OrderStatus;
  readonly fulfilment: FulfilmentType;
  readonly tableName: string | null;
  readonly customerName: string | null;
  readonly notes: string | null;
  readonly items: readonly { name: string; quantity: number; modifiers: readonly string[] }[];
  readonly placedAt: Date | null;
  readonly estimatedReadyAt: Date | null;
}

/** Only what the kitchen is working on, oldest first — the ticket that has waited longest is the one to cook next. */
export function toKitchenTickets(
  rows: readonly KitchenSource[],
  /** order id → ticket prep target in minutes; an order absent from the map has no target. */
  prepTargets: ReadonlyMap<string, number | null> = new Map(),
): readonly KitchenTicket[] {
  return rows
    .filter((row) => isLiveInKitchen(row.status))
    .map((row) => ({
      id: row.id,
      orderNumber: row.orderNumber,
      status: row.status as KitchenStatus,
      fulfilment: row.fulfilment,
      tableName: row.tableName,
      customerName: row.customerName,
      notes: row.notes,
      items: row.items,
      placedAt: row.placedAt?.toISOString() ?? null,
      promisedAt: row.estimatedReadyAt?.toISOString() ?? null,
      prepTargetMinutes: prepTargets.get(row.id) ?? null,
    }))
    .sort((a, b) => (a.placedAt ?? "").localeCompare(b.placedAt ?? ""));
}

/** Whole minutes a ticket has been waiting. Zero if it has no placed time. */
export function waitingMinutes(ticket: Pick<KitchenTicket, "placedAt">, now: number): number {
  if (!ticket.placedAt) return 0;
  return Math.max(0, Math.floor((now - Date.parse(ticket.placedAt)) / 60_000));
}

/**
 * Past the time the counter promised. A fact, not a score; the "nearly late"
 * judgement lives in `prepHealth`, from the prep target.
 */
export function isLate(ticket: Pick<KitchenTicket, "promisedAt">, now: number): boolean {
  return ticket.promisedAt !== null && Date.parse(ticket.promisedAt) < now;
}

/** Share of the prep target after which a ticket is "nearly late" (roadmap 4.1). */
export const NEARLY_LATE_RATIO = 0.8;

/** The ticket's prep target: the slowest line. Lines without a target are ignored; none at all gives null. */
export function ticketPrepTarget(lineMinutes: readonly (number | null | undefined)[]): number | null {
  let target: number | null = null;
  for (const minutes of lineMinutes) {
    if (typeof minutes !== "number" || !Number.isFinite(minutes) || minutes <= 0) continue;
    target = target === null ? minutes : Math.max(target, minutes);
  }
  return target;
}

export type PrepHealth = "GREEN" | "AMBER" | "RED";

/**
 * GREEN / AMBER / RED for a ticket the kitchen is still working on.
 *
 * RED: past the prep target (100%) measured from placement, or past the time
 * the counter promised. AMBER: at or past 80% of the target. Otherwise GREEN.
 * A READY ticket is out of the kitchen's hands, so it is always GREEN, and a
 * ticket with no target and no promise is GREEN — never guessed.
 */
export function prepHealth(
  ticket: Pick<KitchenTicket, "status" | "placedAt" | "promisedAt" | "prepTargetMinutes">,
  now: number,
): PrepHealth {
  if (ticket.status === "READY") return "GREEN";
  if (isLate(ticket, now)) return "RED";
  if (ticket.prepTargetMinutes === null || ticket.placedAt === null) return "GREEN";
  const elapsed = now - Date.parse(ticket.placedAt);
  const target = ticket.prepTargetMinutes * 60_000;
  if (elapsed >= target) return "RED";
  if (elapsed >= target * NEARLY_LATE_RATIO) return "AMBER";
  return "GREEN";
}

/** The one move the kitchen makes from each column; READY is handed over by the counter, not here. */
export function nextKitchenStatus(status: KitchenStatus): { to: "PREPARING" | "READY"; label: string } | null {
  if (status === "ACCEPTED") return { to: "PREPARING", label: "Start cooking" };
  if (status === "PREPARING") return { to: "READY", label: "Ready" };
  return null;
}
