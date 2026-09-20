import { describe, expect, it } from "vitest";
import { type LineFact, type PrepSample, hourOfIst, percentile, prepSamples, summarise, summariseByHour, summariseByProduct } from "./analytics";

const at = (iso: string) => new Date(iso);

describe("percentile (nearest rank)", () => {
  it("is null for no values", () => expect(percentile([], 50)).toBeNull());
  it("is the value itself for one", () => expect(percentile([7], 90)).toBe(7));
  it("takes the nearest rank on sorted values, however they arrive", () => {
    const values = [10, 1, 9, 2, 8, 3, 7, 4, 6, 5];
    expect(percentile(values, 50)).toBe(5);
    expect(percentile(values, 90)).toBe(9);
    expect(percentile(values, 100)).toBe(10);
  });
  it("does not mutate its input", () => {
    const values = [3, 1, 2];
    percentile(values, 50);
    expect(values).toEqual([3, 1, 2]);
  });
  it("rejects a percentile outside 1..100", () => {
    expect(() => percentile([1], 0)).toThrow();
    expect(() => percentile([1], 101)).toThrow();
  });
});

describe("summarise", () => {
  it("is null when there are no samples — no data, never zero", () => expect(summarise([])).toBeNull());
  it("gives count, p50, p90 and the mean, in seconds", () => {
    expect(summarise([60, 120, 180, 240, 300])).toEqual({ count: 5, p50: 180, p90: 300, mean: 180 });
  });
  it("rounds the mean to whole seconds", () => expect(summarise([1, 2])?.mean).toBe(2));
});

describe("prepSamples", () => {
  const ev = (orderId: string, toStatus: string, iso: string) => ({ orderId, toStatus, at: at(iso) });

  it("is the time from the first ACCEPTED to the first READY after it", () => {
    const out = prepSamples([ev("a", "ACCEPTED", "2026-09-12T10:00:00Z"), ev("a", "PREPARING", "2026-09-12T10:02:00Z"), ev("a", "READY", "2026-09-12T10:09:30Z")]);
    expect(out).toEqual([{ orderId: "a", acceptedAt: at("2026-09-12T10:00:00Z"), readyAt: at("2026-09-12T10:09:30Z"), seconds: 570 }]);
  });
  it("ignores an order that was never marked READY, or never ACCEPTED", () => {
    expect(prepSamples([ev("a", "ACCEPTED", "2026-09-12T10:00:00Z")])).toEqual([]);
    expect(prepSamples([ev("b", "READY", "2026-09-12T10:00:00Z")])).toEqual([]);
  });
  it("uses the first ACCEPTED and first READY when either repeats, in any input order", () => {
    const out = prepSamples([
      ev("a", "READY", "2026-09-12T10:20:00Z"),
      ev("a", "ACCEPTED", "2026-09-12T10:05:00Z"),
      ev("a", "READY", "2026-09-12T10:10:00Z"),
      ev("a", "ACCEPTED", "2026-09-12T10:01:00Z"),
    ]);
    expect(out[0]?.seconds).toBe(540); // 10:01 -> 10:10
  });
  it("drops a READY that is not after ACCEPTED", () => {
    expect(prepSamples([ev("a", "ACCEPTED", "2026-09-12T10:10:00Z"), ev("a", "READY", "2026-09-12T10:10:00Z")])).toEqual([]);
  });
  it("keeps orders apart", () => {
    const out = prepSamples([ev("a", "ACCEPTED", "2026-09-12T10:00:00Z"), ev("b", "ACCEPTED", "2026-09-12T10:00:00Z"), ev("a", "READY", "2026-09-12T10:05:00Z"), ev("b", "READY", "2026-09-12T10:07:00Z")]);
    expect(out.map((s) => [s.orderId, s.seconds])).toEqual([["a", 300], ["b", 420]]);
  });
});

describe("hourOfIst", () => {
  it("reads the hour in Ambala, not in UTC", () => {
    expect(hourOfIst(at("2026-09-12T18:29:00Z"))).toBe(23);
    expect(hourOfIst(at("2026-09-12T18:30:00Z"))).toBe(0);
    expect(hourOfIst(at("2026-09-12T06:30:00Z"))).toBe(12);
  });
});

const sample = (orderId: string, hourUtc: number, seconds: number): PrepSample => ({
  orderId,
  acceptedAt: at(`2026-09-12T${String(hourUtc).padStart(2, "0")}:00:00Z`),
  readyAt: at("2026-09-12T23:00:00Z"),
  seconds,
});

describe("summariseByHour", () => {
  it("buckets by the IST hour the order was accepted, and leaves out hours with no orders", () => {
    const rows = summariseByHour([sample("a", 6, 300), sample("b", 6, 500), sample("c", 7, 100)]);
    expect(rows.map((r) => r.hour)).toEqual([11, 12]); // 06:00Z = 11:30 IST, 07:00Z = 12:30 IST
    expect(rows[0]?.summary).toEqual({ count: 2, p50: 300, p90: 500, mean: 400 });
  });
  it("is empty for no samples", () => expect(summariseByHour([])).toEqual([]));
});

describe("summariseByProduct", () => {
  const line = (orderId: string, key: string, name: string, targetMinutes: number | null = null): LineFact => ({ orderId, productKey: key, productName: name, targetMinutes });
  const samples = [sample("o1", 6, 600), sample("o2", 6, 300), sample("o3", 6, 900)];

  it("gives each product the prep time of every order it appeared in, once per order", () => {
    const rows = summariseByProduct(samples, [line("o1", "burger", "Burger"), line("o1", "burger", "Burger"), line("o2", "burger", "Burger"), line("o2", "fries", "Fries"), line("o3", "fries", "Fries")]);
    const burger = rows.find((r) => r.productKey === "burger");
    expect(burger?.summary.count).toBe(2); // o1 counted once despite two lines
    expect(burger?.summary.p50).toBe(300);
    expect(rows.find((r) => r.productKey === "fries")?.summary.count).toBe(2);
  });
  it("ranks slowest first by median, then p90, then name, and says how many orders stand behind each", () => {
    const rows = summariseByProduct(samples, [line("o1", "a", "Alpha"), line("o2", "b", "Bravo"), line("o3", "c", "Charlie")]);
    expect(rows.map((r) => r.productKey)).toEqual(["c", "a", "b"]);
  });
  it("carries the configured target, or null when none is set", () => {
    const rows = summariseByProduct(samples, [line("o1", "a", "Alpha", 8), line("o2", "b", "Bravo")]);
    expect(rows.find((r) => r.productKey === "a")?.targetMinutes).toBe(8);
    expect(rows.find((r) => r.productKey === "b")?.targetMinutes).toBeNull();
  });
  it("leaves out lines of orders with no prep sample, and products with no samples at all", () => {
    expect(summariseByProduct(samples, [line("ghost", "x", "Ghost")])).toEqual([]);
  });
});
