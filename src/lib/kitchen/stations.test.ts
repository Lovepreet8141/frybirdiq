import { describe, expect, it } from "vitest";
import {
  LINE_STATIONS,
  STATIONS,
  type StationLine,
  type StationOrder,
  expoView,
  normaliseCategoryName,
  packBoard,
  packRequired,
  parseLineStation,
  parseStation,
  productStationList,
  resolveLineStation,
  resolveTasks,
  stationBoard,
  stationForCategory,
  visibleStations,
} from "./stations";

const line = (over: Partial<StationLine> = {}): StationLine => ({ id: "l1", name: "Item", quantity: 1, modifiers: [], station: "FRY", done: false, ...over });
const order = (over: Partial<StationOrder> = {}): StationOrder => ({
  id: "o1",
  orderNumber: "001",
  status: "ACCEPTED",
  fulfilment: "TAKEAWAY",
  tableName: null,
  customerName: null,
  notes: null,
  placedAt: "2026-09-12T10:00:00Z",
  promisedAt: null,
  prepTargetMinutes: null,
  packed: false,
  lines: [line()],
  ...over,
});

describe("station names", () => {
  it("knows the four screens", () => {
    expect(STATIONS).toEqual(["FRY", "ASSEMBLY", "DRINKS", "PACK"]);
    expect(LINE_STATIONS).toEqual(STATIONS);
  });
  it("forgives case and padding, nothing else", () => {
    expect(parseStation(" fry ")).toBe("FRY");
    expect(parseStation("grill")).toBeNull();
    expect(parseStation(null)).toBeNull();
  });
  it("PACK takes lines too (sauces and dips)", () => {
    expect(parseStation("pack")).toBe("PACK");
    expect(parseLineStation("pack")).toBe("PACK");
    expect(parseLineStation("drinks")).toBe("DRINKS");
    expect(parseLineStation("grill")).toBeNull();
  });
});

describe("normaliseCategoryName", () => {
  it("ignores case, punctuation and spacing, reads & as and, and singularises", () => {
    expect(normaliseCategoryName("  Mac & Cheese ")).toBe("mac and cheese");
    expect(normaliseCategoryName("MAC AND CHEESE")).toBe("mac and cheese");
    expect(normaliseCategoryName("Fries")).toBe("fry");
    expect(normaliseCategoryName("Combos & Party Boxes")).toBe("combo and party box");
    expect(normaliseCategoryName("Smash Burgers")).toBe("smash burger");
    expect(normaliseCategoryName("Chicken Wings")).toBe("chicken wing");
  });
});

describe("category defaults: every real menu category", () => {
  const expected: readonly [string, "FRY" | "ASSEMBLY" | "DRINKS" | "PACK"][] = [
    ["Burgers", "ASSEMBLY"],
    ["Chicken", "FRY"],
    ["Combos & Party Boxes", "ASSEMBLY"],
    ["Fries", "FRY"],
    ["Mac & Cheese", "ASSEMBLY"],
    ["Rice Bowls", "ASSEMBLY"],
    ["Sauces", "PACK"],
    ["Smash Burgers", "ASSEMBLY"],
    ["Wraps", "ASSEMBLY"],
  ];
  it.each(expected)("%s resolves to %s", (name, station) => {
    expect(stationForCategory(name).station).toBe(station);
  });

  it("the owner's named groups fry", () => {
    for (const name of ["Fried Chicken", "Chicken Tenders", "Tenders", "Popcorn Chicken", "Chicken Wings", "Wings", "Fries", "Loaded Fries"]) {
      expect(stationForCategory(name).station, name).toBe("FRY");
    }
  });
  it("matches without regard to case, plural or &/and", () => {
    expect(stationForCategory("FRIES").station).toBe("FRY");
    expect(stationForCategory("chicken wing").station).toBe("FRY");
    expect(stationForCategory("mac and cheese").station).toBe("ASSEMBLY");
  });
  it("a drink word as a whole word, singular or plural, anywhere in the name makes it DRINKS", () => {
    for (const name of ["Drinks", "Cold Drinks", "Beverages", "Milkshakes", "Shakes", "Soda", "Fresh Juices", "Lassi", "Iced Tea", "Coffee", "Mineral Water", "Hot Beverage Bar", "Tea & Coffee", "TEA AND COFFEE", "Juice Bar"]) {
      expect(stationForCategory(name).station, name).toBe("DRINKS");
    }
  });
  it("a drink word buried inside another word is not a drink", () => {
    for (const name of ["Steak Sandwiches", "Steaks", "Meatballs", "Teaspoon Specials", "Waterfall Fries", "Sodastream Parts", "Shakespeare Bites", "Stealth Wraps"]) {
      expect(stationForCategory(name).station, name).toBe("ASSEMBLY");
    }
  });
  it("anything unmatched, or no category at all, is ASSEMBLY by default", () => {
    for (const name of ["Desserts", "Kids Meals", "Brand New Category", ""]) {
      expect(stationForCategory(name).station, name).toBe("ASSEMBLY");
    }
    expect(stationForCategory(null)).toEqual({ station: "ASSEMBLY", source: "default" });
    expect(stationForCategory("Desserts").source).toBe("default");
    expect(stationForCategory("Burgers").source).toBe("category");
  });
});

describe("resolveLineStation", () => {
  it("resolves the real named products through their category", () => {
    const rows = [
      ...["Chilli Cheese Fries", "Frybird Loaded Fries", "Garlic Parmesan Fries", "Nachos Loaded Fries", "OG Salt Fries", "Peri Peri Fries"].map((product) => ({ category: "Fries", product, override: null })),
      ...["Chicken Tenders", "Chicken Wings", "Popcorn Chicken"].map((product) => ({ category: "Chicken", product, override: null })),
      { category: "Combos & Party Boxes", product: "Party Box", override: null },
      { category: "Sauces", product: "Peri Peri Sauce", override: null },
    ];
    const stations = Object.fromEntries(productStationList(rows).map((r) => [r.product, r.stations[0]]));
    for (const name of ["Chilli Cheese Fries", "Frybird Loaded Fries", "Garlic Parmesan Fries", "Nachos Loaded Fries", "OG Salt Fries", "Peri Peri Fries", "Chicken Tenders", "Chicken Wings", "Popcorn Chicken"]) expect(stations[name], name).toBe("FRY");
    expect(stations["Party Box"]).toBe("ASSEMBLY");
    expect(stations["Peri Peri Sauce"]).toBe("PACK");
  });
  it("a product override beats the category default, both ways", () => {
    expect(resolveLineStation({ override: "ASSEMBLY", categoryName: "Fries" })).toEqual({ station: "ASSEMBLY", source: "override" });
    expect(resolveLineStation({ override: "fry", categoryName: "Burgers" })).toEqual({ station: "FRY", source: "override" });
    expect(resolveLineStation({ override: "DRINKS", categoryName: "Sauces" }).station).toBe("DRINKS");
    expect(resolveLineStation({ override: "PACK", categoryName: "Fries" })).toEqual({ station: "PACK", source: "override" });
    expect(resolveLineStation({ override: "ASSEMBLY", categoryName: "Sauces" })).toEqual({ station: "ASSEMBLY", source: "override" });
  });
  it("an override that is not a station is ignored and the category answers", () => {
    expect(resolveLineStation({ override: "grill", categoryName: "Burgers" }).station).toBe("ASSEMBLY");
    expect(resolveLineStation({ override: "", categoryName: "Fries" }).source).toBe("category");
  });
});

describe("productStationList", () => {
  const rows = [
    { category: "Burgers", product: "Zinger", override: null },
    { category: "Fries", product: "Peri Peri Fries", override: null },
    { category: "Fries", product: "OG Salt Fries", override: "ASSEMBLY" },
    { category: "Sauces", product: "Mayo", override: null },
    { category: "Cold Drinks", product: "Cola", override: null },
    { category: null, product: "Mystery", override: null },
  ];
  it("lists every product with its stations and why, grouped by first station", () => {
    expect(productStationList(rows).map((r) => [r.stations.join("+"), r.category, r.product, r.source])).toEqual([
      ["FRY", "Fries", "Peri Peri Fries", "category"],
      ["ASSEMBLY", null, "Mystery", "default"],
      ["ASSEMBLY", "Burgers", "Zinger", "category"],
      ["ASSEMBLY", "Fries", "OG Salt Fries", "override"],
      ["DRINKS", "Cold Drinks", "Cola", "category"],
      ["PACK", "Sauces", "Mayo", "category"],
    ]);
  });
  it("has one row per input row", () => expect(productStationList(rows)).toHaveLength(rows.length));
  it("is empty for no products", () => expect(productStationList([])).toEqual([]));
  it("on a dine-in order sauces are listed at ASSEMBLY, not PACK", () => {
    expect(productStationList([{ category: "Sauces", product: "Mayo", override: null }], "DINE_IN")[0]?.stations).toEqual(["ASSEMBLY"]);
  });
});

describe("sauces and dips go to PACK", () => {
  it("by category name, whole word, plurals and case forgiven", () => {
    for (const name of ["Sauces", "Sauce", "Dips", "Dip", "Dipping Sauces", "Mayo", "Condiments", "Mayonnaise", "SAUCES & DIPS", "Extra Dips"]) {
      expect(stationForCategory(name).station, name).toBe("PACK");
    }
  });
  it("not when the word is only part of another word, and drinks still win", () => {
    for (const name of ["Saucepan Specials", "Dipika Specials", "Mayonnaisey Things", "Sausage Rolls"]) expect(stationForCategory(name).station, name).toBe("ASSEMBLY");
    expect(stationForCategory("Tea Dips").station).toBe("DRINKS");
  });
  it("a per-product override still wins", () => {
    expect(resolveTasks({ override: "ASSEMBLY", categoryName: "Sauces", isCombo: false, components: [] }, "TAKEAWAY")).toEqual([{ station: "ASSEMBLY", source: "override" }]);
    expect(resolveTasks({ override: "FRY", categoryName: "Sauces", isCombo: false, components: [] }, "DELIVERY")).toEqual([{ station: "FRY", source: "override" }]);
  });
  it("on takeaway and delivery the sauce line is a PACK task", () => {
    const sauce = { override: null, categoryName: "Sauces", isCombo: false, components: [] } as const;
    expect(resolveTasks(sauce, "TAKEAWAY")).toEqual([{ station: "PACK", source: "category" }]);
    expect(resolveTasks(sauce, "DELIVERY")).toEqual([{ station: "PACK", source: "category" }]);
  });
  it("on a dine-in order there is no PACK step, so the sauce line goes to ASSEMBLY (also for a PACK override)", () => {
    expect(resolveTasks({ override: null, categoryName: "Sauces", isCombo: false, components: [] }, "DINE_IN")).toEqual([{ station: "ASSEMBLY", source: "category" }]);
    expect(resolveTasks({ override: "PACK", categoryName: "Fries", isCombo: false, components: [] }, "DINE_IN")).toEqual([{ station: "ASSEMBLY", source: "override" }]);
  });
});

describe("resolveTasks: combos", () => {
  const combo = (components: { override: string | null; categoryName: string | null }[], over: { override?: string | null } = {}) => ({ override: over.override ?? null, categoryName: "Combos & Party Boxes", isCombo: true, components });
  const stationsOf = (routing: ReturnType<typeof combo>, fulfilment: "TAKEAWAY" | "DINE_IN" = "TAKEAWAY") => resolveTasks(routing, fulfilment).map((t) => t.station);

  it("expands into components, each at its own station, without repeats, in kitchen order", () => {
    expect(stationsOf(combo([{ override: null, categoryName: "Burgers" }, { override: null, categoryName: "Fries" }, { override: null, categoryName: "Fries" }]))).toEqual(["FRY", "ASSEMBLY"]);
    expect(resolveTasks(combo([{ override: null, categoryName: "Fries" }]), "TAKEAWAY")).toEqual([{ station: "FRY", source: "combo-components" }]);
  });
  it("a component that is itself overridden goes where its override says", () => {
    expect(stationsOf(combo([{ override: "DRINKS", categoryName: "Fries" }, { override: null, categoryName: "Burgers" }]))).toEqual(["ASSEMBLY", "DRINKS"]);
  });
  it("a sauce component is a PACK task, or ASSEMBLY on dine-in", () => {
    const c = combo([{ override: null, categoryName: "Fries" }, { override: null, categoryName: "Sauces" }]);
    expect(stationsOf(c)).toEqual(["FRY", "PACK"]);
    expect(stationsOf(c, "DINE_IN")).toEqual(["FRY", "ASSEMBLY"]);
  });
  it("a combo with no components shows on both FRY and ASSEMBLY", () => {
    expect(resolveTasks(combo([]), "TAKEAWAY")).toEqual([
      { station: "FRY", source: "combo-no-components" },
      { station: "ASSEMBLY", source: "combo-no-components" },
    ]);
  });
  it("a combo's own override wins over its components", () => {
    expect(resolveTasks(combo([{ override: null, categoryName: "Fries" }], { override: "ASSEMBLY" }), "TAKEAWAY")).toEqual([{ station: "ASSEMBLY", source: "override" }]);
  });
  it("the list reports the combo source", () => {
    const list = productStationList([
      { category: "Combos & Party Boxes", product: "With parts", override: null, isCombo: true, components: [{ category: "Fries", product: "Fries", override: null }, { category: "Burgers", product: "Burger", override: null }] },
      { category: "Combos & Party Boxes", product: "Empty", override: null, isCombo: true },
    ]);
    expect(list.map((r) => [r.product, r.stations.join("+"), r.source])).toEqual([
      ["Empty", "FRY+ASSEMBLY", "combo-no-components"],
      ["With parts", "FRY+ASSEMBLY", "combo-components"],
    ]);
  });
});

describe("visibleStations", () => {
  it("hides DRINKS while nothing resolves to it", () => {
    expect(visibleStations(["FRY", "ASSEMBLY", "PACK"], [])).toEqual(["FRY", "ASSEMBLY", "PACK"]);
    expect(visibleStations([], [])).toEqual(["FRY", "ASSEMBLY", "PACK"]);
  });
  it("shows it once a menu product resolves to it, or an order in the kitchen already has a drinks task", () => {
    expect(visibleStations(["DRINKS"], [])).toEqual(["FRY", "ASSEMBLY", "DRINKS", "PACK"]);
    expect(visibleStations([], ["DRINKS"])).toEqual(["FRY", "ASSEMBLY", "DRINKS", "PACK"]);
  });
});

describe("packRequired", () => {
  it("is for takeaway and delivery, never dine-in", () => {
    expect(packRequired("TAKEAWAY")).toBe(true);
    expect(packRequired("DELIVERY")).toBe(true);
    expect(packRequired("DINE_IN")).toBe(false);
  });
});

describe("stationBoard", () => {
  const orders = [
    order({ id: "a", lines: [line({ id: "1", station: "FRY" }), line({ id: "2", station: "DRINKS" })] }),
    order({ id: "b", placedAt: "2026-09-12T09:00:00Z", lines: [line({ id: "3", station: "FRY", done: true })] }),
    order({ id: "d", status: "READY", lines: [line({ id: "5", station: "FRY" })] }),
    order({ id: "e", status: "PENDING_PAYMENT" as never, lines: [line({ id: "6", station: "FRY" })] }),
  ];

  it("shows a station only its own lines", () => {
    const fry = stationBoard(orders, "FRY");
    expect(fry.map((o) => o.id)).toEqual(["a"]);
    expect(fry[0]?.lines.map((l) => l.id)).toEqual(["1"]);
    expect(stationBoard(orders, "DRINKS")[0]?.lines.map((l) => l.id)).toEqual(["2"]);
  });
  it("drops an order once the station has done all of its lines there", () => {
    expect(stationBoard(orders, "FRY").some((o) => o.id === "b")).toBe(false);
  });
  it("keeps a station's finished lines visible while another of its lines is open", () => {
    const mixed = [order({ lines: [line({ id: "1", done: true }), line({ id: "2" })] })];
    expect(stationBoard(mixed, "FRY")[0]?.lines.map((l) => l.id)).toEqual(["1", "2"]);
  });
  it("only shows orders the kitchen is working on, oldest first", () => {
    const two = [order({ id: "late", placedAt: "2026-09-12T10:05:00Z" }), order({ id: "early", placedAt: "2026-09-12T10:01:00Z" })];
    expect(stationBoard(two, "FRY").map((o) => o.id)).toEqual(["early", "late"]);
    expect(stationBoard(orders, "FRY").some((o) => o.id === "d" || o.id === "e")).toBe(false);
  });
});

describe("packBoard", () => {
  const done = [line({ id: "1", station: "FRY", done: true }), line({ id: "2", station: "DRINKS", done: true })];
  it("shows a takeaway or delivery order only once every line is done", () => {
    const rows = [
      order({ id: "take", fulfilment: "TAKEAWAY", lines: done }),
      order({ id: "deliver", fulfilment: "DELIVERY", lines: done }),
      order({ id: "partial", fulfilment: "TAKEAWAY", lines: [line({ id: "1", done: true }), line({ id: "2", station: "DRINKS" })] }),
    ];
    expect(packBoard(rows).map((o) => o.id).sort()).toEqual(["deliver", "take"]);
  });
  it("never shows a dine-in order, however done it is", () => {
    expect(packBoard([order({ fulfilment: "DINE_IN", lines: done })])).toEqual([]);
  });
  it("drops an order once it is packed, and ignores orders outside the kitchen", () => {
    expect(packBoard([order({ packed: true, lines: done }), order({ id: "r", status: "READY", lines: done })])).toEqual([]);
  });
  it("shows the whole order, every line, oldest first", () => {
    const rows = [order({ id: "late", placedAt: "2026-09-12T10:05:00Z", lines: done }), order({ id: "early", placedAt: "2026-09-12T10:01:00Z", lines: done })];
    expect(packBoard(rows).map((o) => o.id)).toEqual(["early", "late"]);
    expect(packBoard(rows)[0]?.lines).toHaveLength(2);
  });
  it("opens once every non-PACK task is done, and lists the sauce lines to pack", () => {
    const sauceOrder = order({ lines: [line({ id: "1", station: "FRY", done: true }), line({ id: "2", station: "PACK" })] });
    expect(packBoard([sauceOrder]).map((o) => o.id)).toEqual(["o1"]);
    expect(packBoard([sauceOrder])[0]?.lines.filter((l) => l.station === "PACK")).toHaveLength(1);
    expect(packBoard([order({ lines: [line({ id: "1", station: "FRY" }), line({ id: "2", station: "PACK" })] })])).toEqual([]);
  });
  it("an order with no lines is never packable", () => {
    expect(packBoard([order({ lines: [] })])).toEqual([]);
  });
});

describe("expoView", () => {
  it("shows every live order, with each station's progress in kitchen order", () => {
    const [view] = expoView([order({ lines: [line({ id: "1", station: "DRINKS", done: true }), line({ id: "2", station: "FRY" }), line({ id: "3", station: "FRY", done: true })] })]);
    expect(view?.stations).toEqual([
      { station: "FRY", total: 2, done: 1 },
      { station: "DRINKS", total: 1, done: 1 },
    ]);
    expect(view?.readyToBump).toBe(false);
  });
  it("a dine-in order has no PACK step and is ready once every line is done", () => {
    const [view] = expoView([order({ fulfilment: "DINE_IN", lines: [line({ done: true })] })]);
    expect(view?.pack).toBeNull();
    expect(view?.readyToBump).toBe(true);
  });
  it("a takeaway order walks WAITING, READY_TO_PACK, PACKED, and is ready to bump only when packed", () => {
    const view = (over: Partial<StationOrder>) => expoView([order(over)])[0]!;
    const open = view({ lines: [line({ done: false })] });
    expect(open.pack).toBe("WAITING");
    expect(open.readyToBump).toBe(false);
    const toPack = view({ lines: [line({ done: true })] });
    expect(toPack.pack).toBe("READY_TO_PACK");
    expect(toPack.readyToBump).toBe(false);
    const packed = view({ lines: [line({ done: true })], packed: true });
    expect(packed.pack).toBe("PACKED");
    expect(packed.readyToBump).toBe(true);
  });
  it("a delivery order needs PACK too", () => {
    expect(expoView([order({ fulfilment: "DELIVERY", lines: [line({ done: true })] })])[0]?.readyToBump).toBe(false);
  });
  it("an order with no lines is never ready to bump", () => {
    expect(expoView([order({ fulfilment: "DINE_IN", lines: [] })])[0]?.readyToBump).toBe(false);
  });
  it("leaves out orders that are not in the kitchen and keeps oldest first", () => {
    const rows = [order({ id: "x", status: "READY" }), order({ id: "b", placedAt: "2026-09-12T10:05:00Z" }), order({ id: "a", placedAt: "2026-09-12T10:00:00Z" })];
    expect(expoView(rows).map((o) => o.id)).toEqual(["a", "b"]);
  });
});

describe("expoView with PACK tasks", () => {
  it("is READY_TO_PACK when only PACK tasks remain, and not ready to bump until they are done and it is packed", () => {
    const base = [line({ id: "1", station: "FRY", done: true }), line({ id: "2", station: "PACK" })];
    const toPack = expoView([order({ lines: base })])[0]!;
    expect(toPack.pack).toBe("READY_TO_PACK");
    expect(toPack.readyToBump).toBe(false);
    expect(toPack.stations.map((s) => s.station)).toEqual(["FRY"]);
    const packed = expoView([order({ packed: true, lines: [base[0]!, line({ id: "2", station: "PACK", done: true })] })])[0]!;
    expect(packed.readyToBump).toBe(true);
  });
});

describe("the real menu, product by product", () => {
  const MENU: Readonly<Record<string, readonly string[]>> = {
    Burgers: ["Aloo Tikki Maharaja", "Cheese Volcano", "Nashville Bomb", "OG Frybird Classic", "Paneer Champ", "Peri Inferno", "The Chipotle Burger", "Thunder Burger"],
    Chicken: ["Chicken Tenders", "Chicken Wings", "Popcorn Chicken"],
    "Combos & Party Boxes": ["Boss Combo", "Frybird Combo", "Popcorn Party Box", "Solo Combo", "Tenders Boss Box", "Wings Party Box"],
    Fries: ["Chilli Cheese Fries", "Frybird Loaded Fries", "Garlic Parmesan Fries", "Nachos Loaded Fries", "OG Salt Fries", "Peri Peri Fries"],
    "Mac & Cheese": ["Chicken Loaded Mac & Fries", "Chicken Mac & Cheese", "Classic Mac & Cheese", "Nashville Chicken Mac & Cheese", "OG Mac Smash", "Paneer Mac & Cheese"],
    "Rice Bowls": ["Classic Rice Bowl", "Frybird Rice Bowl", "Paneer Rice Bowl"],
    Sauces: ["Cheese Sauce", "Chipotle Sauce", "Garlic Parmesan", "Garlic Sauce", "Green Sauce", "Peri Peri Mayo", "Signature Mayo"],
    "Smash Burgers": ["Chipotle Smash", "Double Smash", "Nashville Smash", "OG Smash"],
    Wraps: ["Aloo Chatpata Wrap", "Chipotle Crunch Wrap", "Crispy Paneer Wrap", "Nashville Fire Wrap", "The OG Wrap", "The Thunder Wrap"],
  };
  const FRY = new Set([...MENU.Chicken!, ...MENU.Fries!]);

  it("resolves all 49 products: chicken and fries FRY, sauces PACK, combos (no components in this fixture) FRY+ASSEMBLY, the rest ASSEMBLY", () => {
    const rows = Object.entries(MENU).flatMap(([category, products]) => products.map((product) => ({ category, product, override: null, isCombo: category === "Combos & Party Boxes" })));
    expect(rows).toHaveLength(49);
    const list = productStationList(rows);
    expect(list).toHaveLength(49);
    for (const row of list) {
      const where = `${row.category} / ${row.product}`;
      if (row.category === "Sauces") expect([row.stations, row.source], where).toEqual([["PACK"], "category"]);
      else if (row.category === "Combos & Party Boxes") expect([row.stations, row.source], where).toEqual([["FRY", "ASSEMBLY"], "combo-no-components"]);
      else if (FRY.has(row.product)) expect([row.stations, row.source], where).toEqual([["FRY"], "category"]);
      else expect([row.stations, row.source], where).toEqual([["ASSEMBLY"], "category"]);
    }
    const count = (stations: string) => list.filter((row) => row.stations.join("+") === stations).length;
    expect([count("FRY"), count("ASSEMBLY"), count("PACK"), count("FRY+ASSEMBLY"), count("DRINKS")]).toEqual([9, 27, 7, 6, 0]);
  });
});
