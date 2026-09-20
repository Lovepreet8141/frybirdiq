/**
 * Kitchen stations (roadmap 4.2) — pure routing rules.
 *
 * A line's station is resolved in this order:
 *   1. the product's own override (`products.kds_station`, set on the product form),
 *   2. its category's default (`CATEGORY_RULES` and the drink words below),
 *   3. ASSEMBLY.
 * There is no "unassigned": every line lands on a station screen.
 *
 * PACK is not a line station. It is the last step of a TAKEAWAY or DELIVERY
 * order (`packRequired`), done once for the whole order after every line is
 * done; dine-in orders have no PACK step.
 *
 * No React, no database.
 */

import type { FulfilmentType, OrderStatus } from "@/domain/order-status";

/** The stations that cook or assemble lines. A product override can only be one of these. */
export const LINE_STATIONS = ["FRY", "ASSEMBLY", "DRINKS"] as const;
export type LineStation = (typeof LINE_STATIONS)[number];

/** Every station with its own screen. */
export const STATIONS = [...LINE_STATIONS, "PACK"] as const;
export type Station = (typeof STATIONS)[number];

export const DEFAULT_STATION: LineStation = "ASSEMBLY";

export const STATION_LABEL: Readonly<Record<Station, string>> = {
  FRY: "Fry",
  ASSEMBLY: "Assembly",
  DRINKS: "Drinks",
  PACK: "Pack",
};

/** A station name from stored or URL text; null when it is not one of the four screens. Case and padding are forgiven, nothing else. */
export function parseStation(raw: string | null | undefined): Station | null {
  if (!raw) return null;
  const upper = raw.trim().toUpperCase();
  return (STATIONS as readonly string[]).includes(upper) ? (upper as Station) : null;
}

/** As `parseStation`, but only the stations a line can belong to (not PACK). */
export function parseLineStation(raw: string | null | undefined): LineStation | null {
  const station = parseStation(raw);
  return station === null || station === "PACK" ? null : station;
}

/* ------------------------------------------------------------------ */
/* Category defaults — the owner's rules, as data.                     */
/* ------------------------------------------------------------------ */

/**
 * Any of these as a whole word (plural forms included, since names are
 * singularised first) in a category name makes it a drinks category. Whole
 * words only: "Steak" and "Meatballs" contain "tea" and "eat" but are not
 * drinks. "milkshake" is listed because it is one word for a shake.
 */
const DRINK_WORDS: ReadonlySet<string> = new Set(["drink", "beverage", "shake", "milkshake", "soda", "juice", "lassi", "tea", "coffee", "water"]);

/**
 * Category name (normalised: lower case, "&" as "and", singular words) to station.
 * Fried chicken, tenders, popcorn chicken, wings, fries and loaded fries fry;
 * burgers, smash burgers, wraps, rice bowls and mac and cheese assemble.
 * Anything not listed (sauces, combos and party boxes, a new category) falls
 * through to ASSEMBLY.
 */
const CATEGORY_RULES: readonly { readonly name: string; readonly station: LineStation }[] = [
  { name: "fried chicken", station: "FRY" },
  { name: "chicken", station: "FRY" },
  { name: "tender", station: "FRY" },
  { name: "chicken tender", station: "FRY" },
  { name: "popcorn chicken", station: "FRY" },
  { name: "wing", station: "FRY" },
  { name: "chicken wing", station: "FRY" },
  { name: "fry", station: "FRY" },
  { name: "loaded fry", station: "FRY" },
  { name: "burger", station: "ASSEMBLY" },
  { name: "smash burger", station: "ASSEMBLY" },
  { name: "wrap", station: "ASSEMBLY" },
  { name: "rice bowl", station: "ASSEMBLY" },
  { name: "mac and cheese", station: "ASSEMBLY" },
];

function singular(word: string): string {
  if (word.length > 3 && word.endsWith("ies")) return `${word.slice(0, -3)}y`;
  if (word.length > 4 && /(xes|ches|shes|sses)$/.test(word)) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1);
  return word;
}

/** Case-insensitive, "&" is "and", punctuation and spacing ignored, plurals reduced ("Fries" is "fry"). */
export function normaliseCategoryName(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, " and ")
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .map(singular)
    .join(" ");
}

export type StationSource = "override" | "category" | "default";

export interface ResolvedStation {
  readonly station: LineStation;
  /** Where the answer came from, so the owner can see why a product is where it is. */
  readonly source: StationSource;
}

/** The station for a category name alone; `default` when no rule matches. */
export function stationForCategory(categoryName: string | null | undefined): ResolvedStation {
  const normalised = normaliseCategoryName(categoryName ?? "");
  if (normalised.split(" ").some((word) => DRINK_WORDS.has(word))) return { station: "DRINKS", source: "category" };
  const rule = CATEGORY_RULES.find((entry) => entry.name === normalised);
  return rule ? { station: rule.station, source: "category" } : { station: DEFAULT_STATION, source: "default" };
}

/** Override, then category, then ASSEMBLY. An override that is not a line station is ignored, not guessed at. */
export function resolveLineStation(input: { readonly override: string | null | undefined; readonly categoryName: string | null | undefined }): ResolvedStation {
  const override = parseLineStation(input.override);
  return override ? { station: override, source: "override" } : stationForCategory(input.categoryName);
}

export interface ProductStationRow {
  readonly category: string | null;
  readonly product: string;
  readonly override: string | null;
}

export interface ProductStation extends ResolvedStation {
  readonly category: string | null;
  readonly product: string;
}

/** The whole product-to-station list for a set of products, by station then category then product — for showing the owner. */
export function productStationList(rows: readonly ProductStationRow[]): readonly ProductStation[] {
  const order = (station: LineStation) => LINE_STATIONS.indexOf(station);
  return rows
    .map((row) => ({ category: row.category, product: row.product, ...resolveLineStation({ override: row.override, categoryName: row.category }) }))
    .sort((a, b) => order(a.station) - order(b.station) || (a.category ?? "").localeCompare(b.category ?? "") || a.product.localeCompare(b.product));
}

/* ------------------------------------------------------------------ */
/* Orders, boards, Expo                                                */
/* ------------------------------------------------------------------ */

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
  /** The PACK step is done for this order. Always false for dine-in, which has none. */
  readonly packed: boolean;
  readonly lines: readonly StationLine[];
}

/** TAKEAWAY and DELIVERY orders are packed last; dine-in orders are not. */
export function packRequired(fulfilment: FulfilmentType): boolean {
  return fulfilment === "TAKEAWAY" || fulfilment === "DELIVERY";
}

/** Stations only work on what the kitchen has accepted and not yet finished. */
function inWork(order: Pick<StationOrder, "status">): boolean {
  return order.status === "ACCEPTED" || order.status === "PREPARING";
}

const allLinesDone = (order: Pick<StationOrder, "lines">) => order.lines.length > 0 && order.lines.every((line) => line.done);

const oldestFirst = <T extends { placedAt: string | null }>(a: T, b: T) => (a.placedAt ?? "").localeCompare(b.placedAt ?? "");

/** One line station's screen: only its own lines, only orders where it still has something to do, oldest first. */
export function stationBoard(orders: readonly StationOrder[], station: LineStation): readonly StationOrder[] {
  return orders
    .filter(inWork)
    .map((order) => ({ ...order, lines: order.lines.filter((line) => line.station === station) }))
    .filter((order) => order.lines.some((line) => !line.done))
    .sort(oldestFirst);
}

/**
 * The PACK screen: takeaway and delivery orders whose every line is done and
 * that are not yet packed. Whole order, every line, so the packer can check the
 * bag against it. Never a dine-in order.
 */
export function packBoard(orders: readonly StationOrder[]): readonly StationOrder[] {
  return orders.filter((order) => inWork(order) && packRequired(order.fulfilment) && allLinesDone(order) && !order.packed).sort(oldestFirst);
}

export type PackState = "WAITING" | "READY_TO_PACK" | "PACKED";

export interface StationProgress {
  readonly station: LineStation;
  readonly total: number;
  readonly done: number;
}

export interface ExpoOrder extends StationOrder {
  readonly stations: readonly StationProgress[];
  /** Null for dine-in: it has no PACK step. */
  readonly pack: PackState | null;
  /** Every line is done and, where a PACK step exists, it is packed: the one condition for marking the order READY. */
  readonly readyToBump: boolean;
}

/** EXPO: every order the kitchen is working on, each station's progress, the PACK state, and whether it can go out. */
export function expoView(orders: readonly StationOrder[]): readonly ExpoOrder[] {
  return orders
    .filter(inWork)
    .map((order) => {
      const stations: StationProgress[] = [];
      for (const station of LINE_STATIONS) {
        const lines = order.lines.filter((line) => line.station === station);
        if (lines.length > 0) stations.push({ station, total: lines.length, done: lines.filter((line) => line.done).length });
      }
      const linesDone = allLinesDone(order);
      const pack: PackState | null = !packRequired(order.fulfilment) ? null : order.packed ? "PACKED" : linesDone ? "READY_TO_PACK" : "WAITING";
      return { ...order, stations, pack, readyToBump: linesDone && (pack === null || pack === "PACKED") };
    })
    .sort(oldestFirst);
}
