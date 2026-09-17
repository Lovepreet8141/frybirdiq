import { describe, expect, it } from "vitest";
import { endOfBusinessDay, resolveRange, startOfBusinessDay } from "@/lib/dates";
import { exportFilename } from "./filename";

describe("exportFilename", () => {
  it("names the IST business dates the range covers, not the UTC dates of its instants", () => {
    // Midnight IST on 1 Sep is 18:30 UTC on 31 Aug; the last covered instant is 23:59:59.999 IST on 30 Sep.
    const range = { from: startOfBusinessDay("2026-09-01"), to: endOfBusinessDay("2026-09-30"), label: "September" };
    expect(exportFilename("orders", range)).toBe("frybird-orders-2026-09-01_to_2026-09-30.csv");
  });

  it("names a single day once on each side", () => {
    const range = resolveRange("yesterday", new Date("2026-09-17T00:10:00+05:30"));
    expect(exportFilename("gst-summary", range)).toBe("frybird-gst-summary-2026-09-16_to_2026-09-16.csv");
  });
});
