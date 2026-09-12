import { describe, expect, it } from "vitest";
import { planSwap } from "./reorder";

/** Rows named r0, r1, … in the order the database returned them, at the given stored positions. */
const rows = (...positions: number[]) => positions.map((position, index) => ({ id: `r${index}`, position }));

describe("planSwap", () => {
  it("returns null for an id that is not among the siblings", () => {
    expect(planSwap(rows(0, 1, 2), "nope", "up")).toBeNull();
  });

  it("does nothing at the top going up, or at the bottom going down", () => {
    expect(planSwap(rows(0, 1, 2), "r0", "up")).toBeNull();
    expect(planSwap(rows(0, 1, 2), "r2", "down")).toBeNull();
  });

  it("a lone row cannot move either way", () => {
    expect(planSwap(rows(0), "r0", "up")).toBeNull();
    expect(planSwap(rows(0), "r0", "down")).toBeNull();
  });

  it("swaps exactly the two neighbours when positions are already contiguous", () => {
    expect(planSwap(rows(0, 1, 2), "r1", "up")).toEqual([
      { id: "r1", position: 0 },
      { id: "r0", position: 1 },
    ]);
    expect(planSwap(rows(0, 1, 2), "r1", "down")).toEqual([
      { id: "r2", position: 1 },
      { id: "r1", position: 2 },
    ]);
  });

  it("heals rows that all share a position, so the move is actually visible", () => {
    // Three legacy rows all at 0: swapping 0 with 0 would persist nothing.
    expect(planSwap(rows(0, 0, 0), "r1", "up")).toEqual([
      { id: "r0", position: 1 },
      { id: "r2", position: 2 },
    ]);
  });

  it("closes gaps left behind by deletes", () => {
    expect(planSwap(rows(0, 5, 9), "r2", "up")).toEqual([
      { id: "r2", position: 1 },
      { id: "r1", position: 2 },
    ]);
  });

  it("never touches a row that is already where it belongs", () => {
    const writes = planSwap(rows(0, 1, 2, 3), "r1", "down") ?? [];
    expect(writes.map((w) => w.id).sort()).toEqual(["r1", "r2"]);
  });
});
