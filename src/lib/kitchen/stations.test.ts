import { describe, expect, it } from "vitest";
import { STATIONS, UNASSIGNED, type StationLine, type StationOrder, expoView, parseStation, stationBoard, stationOfLine } from "./stations";

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
  lines: [line()],
  ...over,
});

describe("parseStation", () => {
  it("knows the four stations", () => expect(STATIONS).toEqual(["FRY", "ASSEMBLY", "DRINKS", "PACK"]));
  it("accepts a station regardless of case and padding", () => {
    expect(parseStation(" fry ")).toBe("FRY");
    expect(parseStation("Assembly")).toBe("ASSEMBLY");
  });
  it("gives null for nothing or for anything that is not a station", () => {
    expect(parseStation(null)).toBeNull();
    expect(parseStation("")).toBeNull();
    expect(parseStation("grill")).toBeNull();
  });
});

describe("stationOfLine", () => {
  it("an unset or unrecognised mapping is UNASSIGNED, never guessed", () => {
    expect(stationOfLine(null)).toBe(UNASSIGNED);
    expect(stationOfLine("grill")).toBe(UNASSIGNED);
    expect(stationOfLine("DRINKS")).toBe("DRINKS");
  });
});

describe("stationBoard", () => {
  const orders = [
    order({ id: "a", lines: [line({ id: "1", station: "FRY" }), line({ id: "2", station: "DRINKS" })] }),
    order({ id: "b", placedAt: "2026-09-12T09:00:00Z", lines: [line({ id: "3", station: "FRY", done: true })] }),
    order({ id: "c", lines: [line({ id: "4", station: UNASSIGNED })] }),
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
  it("never shows unassigned lines on a station screen", () => {
    for (const s of STATIONS) expect(stationBoard(orders, s).some((o) => o.id === "c")).toBe(false);
  });
  it("only shows orders the kitchen is working on, oldest first", () => {
    const two = [order({ id: "late", placedAt: "2026-09-12T10:05:00Z" }), order({ id: "early", placedAt: "2026-09-12T10:01:00Z" })];
    expect(stationBoard(two, "FRY").map((o) => o.id)).toEqual(["early", "late"]);
    expect(stationBoard(orders, "FRY").some((o) => o.id === "d" || o.id === "e")).toBe(false);
  });
});

describe("expoView", () => {
  it("shows every live order, with each station's progress", () => {
    const [view] = expoView([order({ lines: [line({ id: "1", station: "FRY", done: true }), line({ id: "2", station: "FRY" }), line({ id: "3", station: "DRINKS", done: true })] })]);
    expect(view?.stations).toEqual([
      { station: "FRY", total: 2, done: 1 },
      { station: "DRINKS", total: 1, done: 1 },
    ]);
    expect(view?.readyToBump).toBe(false);
  });
  it("orders the stations the way the kitchen lists them, unassigned last", () => {
    const [view] = expoView([order({ lines: [line({ id: "1", station: UNASSIGNED }), line({ id: "2", station: "PACK" }), line({ id: "3", station: "FRY" })] })]);
    expect(view?.stations.map((s) => s.station)).toEqual(["FRY", "PACK", UNASSIGNED]);
  });
  it("an unassigned line is visible and blocks the order until someone marks it", () => {
    const blocked = expoView([order({ lines: [line({ id: "1", station: "FRY", done: true }), line({ id: "2", station: UNASSIGNED })] })])[0];
    expect(blocked?.unassignedCount).toBe(1);
    expect(blocked?.readyToBump).toBe(false);
  });
  it("is ready to bump only when every line, in every station, is done", () => {
    const all = expoView([order({ lines: [line({ id: "1", station: "FRY", done: true }), line({ id: "2", station: UNASSIGNED, done: true })] })])[0];
    expect(all?.readyToBump).toBe(true);
  });
  it("an order with no lines is never ready to bump", () => {
    expect(expoView([order({ lines: [] })])[0]?.readyToBump).toBe(false);
  });
  it("leaves out orders that are not in the kitchen and keeps oldest first", () => {
    const rows = [order({ id: "x", status: "READY" }), order({ id: "b", placedAt: "2026-09-12T10:05:00Z" }), order({ id: "a", placedAt: "2026-09-12T10:00:00Z" })];
    expect(expoView(rows).map((o) => o.id)).toEqual(["a", "b"]);
  });
});
