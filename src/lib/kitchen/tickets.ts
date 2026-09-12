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
export function toKitchenTickets(rows: readonly KitchenSource[]): readonly KitchenTicket[] {
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
    }))
    .sort((a, b) => (a.placedAt ?? "").localeCompare(b.placedAt ?? ""));
}

/** Whole minutes a ticket has been waiting. Zero if it has no placed time. */
export function waitingMinutes(ticket: Pick<KitchenTicket, "placedAt">, now: number): number {
  if (!ticket.placedAt) return 0;
  return Math.max(0, Math.floor((now - Date.parse(ticket.placedAt)) / 60_000));
}

/**
 * Past the time the counter promised. A fact, not a score: there is no
 * amber, because "nearly late" needs a threshold nobody has decided.
 */
export function isLate(ticket: Pick<KitchenTicket, "promisedAt">, now: number): boolean {
  return ticket.promisedAt !== null && Date.parse(ticket.promisedAt) < now;
}

/** The one move the kitchen makes from each column; READY is handed over by the counter, not here. */
export function nextKitchenStatus(status: KitchenStatus): { to: "PREPARING" | "READY"; label: string } | null {
  if (status === "ACCEPTED") return { to: "PREPARING", label: "Start cooking" };
  if (status === "PREPARING") return { to: "READY", label: "Ready" };
  return null;
}
