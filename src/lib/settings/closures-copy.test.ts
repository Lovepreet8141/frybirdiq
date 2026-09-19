import { describe, expect, it } from "vitest";
import { preOrderRows, rangeLabel, savedMessage, shortDate } from "./closures-copy";

describe("closures copy", () => {
  it("dates and ranges", () => {
    expect(shortDate("2026-09-22")).toBe("Tue 22 Sep");
    expect(rangeLabel("2026-09-22", "2026-09-22")).toBe("Tue 22 Sep");
    expect(rangeLabel("2026-09-24", "2026-09-26")).toBe("Thu 24 Sep – Sat 26 Sep");
  });

  it("the saved message says how many pre-orders sit on the day and that nothing was cancelled", () => {
    expect(savedMessage("Closed date", 0)).toBe("Closed date saved. No pre-orders are booked for it.");
    expect(savedMessage("Closed date", 1)).toContain("1 pre-order is already booked");
    expect(savedMessage("Weekly days off", 3)).toContain("3 pre-orders are already booked");
    expect(savedMessage("Closed date", 2)).toContain("Nothing was cancelled");
  });

  it("a pre-order row names the order, the customer and the slot in the shop's own clock", () => {
    const rows = preOrderRows([
      { orderId: "o1", orderNumber: "1301", customerName: "Asha", scheduledFor: new Date("2026-09-22T13:00:00+05:30"), date: "2026-09-22", status: "ACCEPTED", note: null },
    ]);
    expect(rows).toEqual([{ orderId: "o1", orderNumber: "1301", customerName: "Asha", when: "Tue 22 Sep, 1:00 PM", status: "ACCEPTED", note: null }]);
  });
});
