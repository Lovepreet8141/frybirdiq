/**
 * Kitchen stations (roadmap 4.2) — pure routing rules.
 *
 * A line belongs to whichever station its product's `kds_station` names. That
 * is configured data on the product: nothing here maps a product to a
 * station, and a product with no (or an unrecognised) station is UNASSIGNED,
 * which no station screen shows and EXPO always does — so a line can never be
 * invisible, only unrouted.
 *
 * No React, no database.
 */

import type { FulfilmentType, OrderStatus } from "@/domain/order-status";

export const STATIONS = ["FRY", "ASSEMBLY", "DRINKS", "PACK"] as const;
export type Station = (typeof STATIONS)[number];

export const UNASSIGNED = "UNASSIGNED" as const;
export type LineStation = Station | typeof UNASSIGNED;

/** Display order on EXPO: the stations as the kitchen lists them, then the unrouted. */
const STATION_ORDER: readonly LineStation[] = [...STATIONS, UNASSIGNED];

export const STATION_LABEL: Readonly<Record<LineStation, string>> = {
  FRY: "Fry",
  ASSEMBLY: "Assembly",
  DRINKS: "Drinks",
  PACK: "Pack",
  UNASSIGNED: "Unassigned",
};

/** A station name from stored or URL text; null when it is not one of the four. Case and padding are forgiven, nothing else. */
export function parseStation(raw: string | null | undefined): Station | null {
  if (!raw) return null;
  const upper = raw.trim().toUpperCase();
  return (STATIONS as readonly string[]).includes(upper) ? (upper as Station) : null;
}

/** The station a stored `products.kds_station` routes a line to. Unset or unrecognised is UNASSIGNED — never a guess. */
export function stationOfLine(stored: string | null | undefined): LineStation {
  return parseStation(stored) ?? UNASSIGNED;
}

export interface StationLine {
  /** order_items.id */
  readonly id: string;
  readonly name: string;
  readonly quantity: number;
  readonly modifiers: readonly string[];
  readonly station: LineStation;
  readonly done: boolean;
}

export interface StationOrder {
  readonly id: string;
  readonly orderNumber: string;
  readonly status: OrderStatus;
  readonly fulfilment: FulfilmentType;
  readonly tableName: string | null;
  readonly customerName: string | null;
  readonly notes: string | null;
  readonly placedAt: string | null;
  readonly promisedAt: string | null;
  /** Roadmap 4.1: minutes the slowest line is expected to take; null when none is configured. */
  readonly prepTargetMinutes: number | null;
  readonly lines: readonly StationLine[];
}

/** Stations only work on what the kitchen has accepted and not yet finished. */
function inWork(order: Pick<StationOrder, "status">): boolean {
  return order.status === "ACCEPTED" || order.status === "PREPARING";
}

const oldestFirst = <T extends { placedAt: string | null }>(a: T, b: T) => (a.placedAt ?? "").localeCompare(b.placedAt ?? "");

/** One station's screen: only its own lines, only orders where it still has something to do, oldest first. */
export function stationBoard(orders: readonly StationOrder[], station: Station): readonly StationOrder[] {
  return orders
    .filter(inWork)
    .map((order) => ({ ...order, lines: order.lines.filter((line) => line.station === station) }))
    .filter((order) => order.lines.some((line) => !line.done))
    .sort(oldestFirst);
}

export interface StationProgress {
  readonly station: LineStation;
  readonly total: number;
  readonly done: number;
}

export interface ExpoOrder extends StationOrder {
  readonly stations: readonly StationProgress[];
  /** Lines nobody's station owns. They show here, and EXPO marks them done. */
  readonly unassignedCount: number;
  /** Every line of every station is done: the one condition for marking the order READY. */
  readonly readyToBump: boolean;
}

/** EXPO: every order the kitchen is working on, each station's progress, and whether it can go out. */
export function expoView(orders: readonly StationOrder[]): readonly ExpoOrder[] {
  return orders
    .filter(inWork)
    .map((order) => {
      const stations: StationProgress[] = [];
      for (const station of STATION_ORDER) {
        const lines = order.lines.filter((line) => line.station === station);
        if (lines.length > 0) stations.push({ station, total: lines.length, done: lines.filter((line) => line.done).length });
      }
      return {
        ...order,
        stations,
        unassignedCount: order.lines.filter((line) => line.station === UNASSIGNED).length,
        readyToBump: order.lines.length > 0 && order.lines.every((line) => line.done),
      };
    })
    .sort(oldestFirst);
}
