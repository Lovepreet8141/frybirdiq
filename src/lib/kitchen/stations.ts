/**
 * Kitchen stations (roadmap 4.2) — pure routing rules.
 *
 * A product resolves to a station in this order:
 *   1. its own override (`products.kds_station`, set on the product form),
 *   2. its category's default (`CATEGORY_RULES`, the drink words, the sauce words),
 *   3. ASSEMBLY.
 * There is no "unassigned": every line lands on a station screen.
 *
 * A COMBO line is expanded into its components (`combo_items`), and each
 * component goes to its own station by the rules above. A combo with no
 * components defined shows on FRY and ASSEMBLY both, so nothing is missed. A
 * line can therefore be several station tasks; each station marks its own.
 *
 * Sauces and dips go to PACK. PACK is the last step of a TAKEAWAY or DELIVERY
 * order: it lists those sauce/dip lines, opens once every other task is done,
 * and "Packed" completes them and the order's pack step together. A DINE-IN
 * order has no PACK step and no PACK screen, so its sauce/dip lines go to
 * ASSEMBLY instead (`resolveTasks`).
 *
 * No React, no database.
 */

import type { FulfilmentType, OrderStatus } from "@/domain/order-status";

/** Every station with its own screen. Each takes lines; PACK also has the order-level packed step. */
export const STATIONS = ["FRY", "ASSEMBLY", "DRINKS", "PACK"] as const;
export type Station = (typeof STATIONS)[number];
export const LINE_STATIONS = STATIONS;
export type LineStation = Station;

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

/** A product override: any of the four stations. */
export function parseLineStation(raw: string | null | undefined): LineStation | null {
  return parseStation(raw);
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

/** Whole words that make a category a sauces-and-dips category: those lines are packed, not assembled. */
const SAUCE_WORDS: ReadonlySet<string> = new Set(["sauce", "dip", "dipping", "mayo", "mayonnaise", "condiment"]);

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
  const words = normalised.split(" ");
  if (words.some((word) => DRINK_WORDS.has(word))) return { station: "DRINKS", source: "category" };
  if (words.some((word) => SAUCE_WORDS.has(word))) return { station: "PACK", source: "category" };
  const rule = CATEGORY_RULES.find((entry) => entry.name === normalised);
  return rule ? { station: rule.station, source: "category" } : { station: DEFAULT_STATION, source: "default" };
}

/** Override, then category, then ASSEMBLY. An override that is not a line station is ignored, not guessed at. */
export function resolveLineStation(input: { readonly override: string | null | undefined; readonly categoryName: string | null | undefined }): ResolvedStation {
  const override = parseLineStation(input.override);
  return override ? { station: override, source: "override" } : stationForCategory(input.categoryName);
}

/** How a product's stations were arrived at. */
export type TaskSource = StationSource | "combo-components" | "combo-no-components";

/** What the router needs to know about one component or product. */
export interface RoutingProduct {
  readonly override: string | null | undefined;
  readonly categoryName: string | null | undefined;
}

/** A product as the router sees it: a combo carries the components stored for it (empty when none are defined). */
export interface ProductRouting extends RoutingProduct {
  readonly isCombo: boolean;
  readonly components: readonly RoutingProduct[];
}

export interface StationTask {
  readonly station: LineStation;
  readonly source: TaskSource;
}

/**
 * The station tasks one order line becomes, in kitchen order, without repeats.
 *
 * - A simple product: one task, by override, category, then ASSEMBLY.
 * - A combo with its own override: that one station. Otherwise each component
 *   goes to its own station by the same rules, and stations are merged.
 * - A combo with no components defined: FRY and ASSEMBLY both.
 *
 * DINE-IN has no PACK step and no PACK screen, so a task that would land on
 * PACK (sauces and dips) goes to ASSEMBLY on a dine-in order.
 */
export function resolveTasks(routing: ProductRouting, fulfilment: FulfilmentType): readonly StationTask[] {
  const place = (station: LineStation): LineStation => (station === "PACK" && !packRequired(fulfilment) ? "ASSEMBLY" : station);
  const merge = (tasks: readonly StationTask[]): readonly StationTask[] => {
    const seen = new Set<LineStation>();
    const out: StationTask[] = [];
    for (const station of LINE_STATIONS) {
      const task = tasks.find((t) => t.station === station);
      if (task && !seen.has(station)) {
        seen.add(station);
        out.push(task);
      }
    }
    return out;
  };

  const own = resolveLineStation(routing);
  if (!routing.isCombo || own.source === "override") return [{ station: place(own.station), source: own.source }];

  if (routing.components.length === 0) {
    return merge([
      { station: "FRY", source: "combo-no-components" },
      { station: "ASSEMBLY", source: "combo-no-components" },
    ]);
  }
  return merge(routing.components.map((component) => ({ station: place(resolveLineStation(component).station), source: "combo-components" as const })));
}

export interface ProductStationRow {
  readonly category: string | null;
  readonly product: string;
  readonly override: string | null;
  readonly isCombo?: boolean;
  /** Components stored for a combo; leave out or empty when none are defined. */
  readonly components?: readonly { readonly category: string | null; readonly product: string; readonly override: string | null }[];
}

export interface ProductStation {
  readonly category: string | null;
  readonly product: string;
  /** Every station this product's line is worked at, in kitchen order. */
  readonly stations: readonly LineStation[];
  readonly source: TaskSource;
}

/**
 * The whole product-to-station list for a set of products — for showing the
 * owner. Worked out as for a TAKEAWAY or DELIVERY order (where sauces go to
 * PACK) unless told otherwise. Sorted by first station, category, product.
 */
export function productStationList(rows: readonly ProductStationRow[], fulfilment: FulfilmentType = "TAKEAWAY"): readonly ProductStation[] {
  const index = (station: LineStation) => LINE_STATIONS.indexOf(station);
  return rows
    .map((row) => {
      const tasks = resolveTasks(
        {
          override: row.override,
          categoryName: row.category,
          isCombo: row.isCombo ?? false,
          components: (row.components ?? []).map((component) => ({ override: component.override, categoryName: component.category })),
        },
        fulfilment,
      );
      return { category: row.category, product: row.product, stations: tasks.map((task) => task.station), source: tasks[0]?.source ?? ("default" as const) };
    })
    .sort((a, b) => index(a.stations[0]!) - index(b.stations[0]!) || (a.category ?? "").localeCompare(b.category ?? "") || a.product.localeCompare(b.product));
}

/**
 * The stations that get a screen tab: FRY, ASSEMBLY and PACK always; DRINKS
 * only once a product in the org's live menu resolves to it, or an order in
 * the kitchen already has a drinks task (so a task is never left without a
 * screen to mark it on). DRINKS still routes correctly while hidden.
 */
export function visibleStations(menuStations: readonly LineStation[], liveOrderStations: readonly LineStation[]): readonly LineStation[] {
  const used = new Set<LineStation>([...menuStations, ...liveOrderStations]);
  return LINE_STATIONS.filter((station) => station !== "DRINKS" || used.has("DRINKS"));
}

/* ------------------------------------------------------------------ */
/* Orders, boards, Expo                                                */
/* ------------------------------------------------------------------ */

/** One task: an order line at one station. A combo line is several tasks with the same `id`. */
export interface StationLine {
  /** order_items.id (with `station`, identifies the task) */
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
 * The PACK screen: takeaway and delivery orders whose every non-PACK task is
 * done and that are not yet packed. The PACK tasks (sauces and dips) are the
 * lines to pack; `lines` holds all of the order's tasks so the packer can check
 * the bag against it. Never a dine-in order.
 */
export function packBoard(orders: readonly StationOrder[]): readonly StationOrder[] {
  return orders
    .filter((order) => inWork(order) && packRequired(order.fulfilment) && order.lines.length > 0 && order.lines.filter((line) => line.station !== "PACK").every((line) => line.done) && !order.packed)
    .sort(oldestFirst);
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
  /** Every task is done and, where a PACK step exists, it is packed: the one condition for marking the order READY. */
  readonly readyToBump: boolean;
}

/** EXPO: every order the kitchen is working on, each station's progress, the PACK state, and whether it can go out. */
export function expoView(orders: readonly StationOrder[]): readonly ExpoOrder[] {
  return orders
    .filter(inWork)
    .map((order) => {
      const stations: StationProgress[] = [];
      // PACK's tasks are shown through the pack state, not as a station chip.
      for (const station of LINE_STATIONS.filter((candidate) => candidate !== "PACK")) {
        const lines = order.lines.filter((line) => line.station === station);
        if (lines.length > 0) stations.push({ station, total: lines.length, done: lines.filter((line) => line.done).length });
      }
      const linesDone = allLinesDone(order);
      const othersDone = order.lines.length > 0 && order.lines.filter((line) => line.station !== "PACK").every((line) => line.done);
      const pack: PackState | null = !packRequired(order.fulfilment) ? null : order.packed ? "PACKED" : othersDone ? "READY_TO_PACK" : "WAITING";
      return { ...order, stations, pack, readyToBump: linesDone && (pack === null || pack === "PACKED") };
    })
    .sort(oldestFirst);
}
