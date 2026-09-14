import { describe, expect, it } from "vitest";
import { paise } from "@/lib/money";
import { capturedByDay, methodShares, paymentsCsv, tillOf, tillSplit, type LedgerPayment } from "./ledger-view";

const at = (iso: string) => new Date(iso);

describe("tillOf", () => {
  it("only cash is the till; every other method comes through a provider", () => {
    expect(tillOf("CASH")).toBe("cash");
    for (const method of ["UPI", "CARD", "NETBANKING", "WALLET", "OTHER"] as const) expect(tillOf(method)).toBe("online");
  });
});

describe("capturedByDay", () => {
  const payments: LedgerPayment[] = [
    { status: "CAPTURED", method: "CASH", amount: paise(10_000), at: at("2026-09-13T20:30:00Z") }, // 02:00 IST on the 14th
    { status: "CAPTURED", method: "UPI", amount: paise(25_000), at: at("2026-09-14T09:00:00Z") },
    { status: "PENDING", method: "UPI", amount: paise(99_900), at: at("2026-09-14T10:00:00Z") },
    { status: "FAILED", method: "CARD", amount: paise(50_000), at: at("2026-09-14T11:00:00Z") },
    { status: "CAPTURED", method: "CASH", amount: paise(5_000), at: at("2026-09-15T05:00:00Z") },
  ];

  it("buckets captured payments by business day and splits cash from online", () => {
    const days = capturedByDay(payments, ["2026-09-13", "2026-09-14", "2026-09-15"]);
    expect(days.map((day) => [day.date, day.cash, day.online, day.total])).toEqual([
      ["2026-09-13", 0n, 0n, 0n],
      ["2026-09-14", 10_000n, 25_000n, 35_000n],
      ["2026-09-15", 5_000n, 0n, 5_000n],
    ]);
  });

  it("never sums a pending or failed payment", () => {
    const [day] = capturedByDay(payments.filter((p) => p.status !== "CAPTURED"), ["2026-09-14"]);
    expect(day).toEqual({ date: "2026-09-14", cash: 0n, online: 0n, total: 0n });
  });

  it("keeps a quiet day as a zero point rather than dropping it", () => {
    expect(capturedByDay([], ["2026-09-01", "2026-09-02"])).toHaveLength(2);
  });
});

describe("methodShares", () => {
  it("expresses each method as a share of everything captured", () => {
    const shares = methodShares(
      [
        { method: "UPI", count: 3, total: paise(75_000) },
        { method: "CASH", count: 1, total: paise(25_000) },
      ],
      paise(100_000),
    );
    expect(shares.map((row) => [row.label, row.shareLabel, row.share])).toEqual([
      ["UPI", "75%", 0.75],
      ["Cash", "25%", 0.25],
    ]);
  });

  it("shows a dash rather than dividing by zero", () => {
    expect(methodShares([{ method: "CASH", count: 0, total: paise(0) }], paise(0))[0]?.shareLabel).toBe("—");
  });
});

describe("tillSplit", () => {
  it("adds every online method together against cash", () => {
    const split = tillSplit([
      { method: "UPI", total: paise(30_000) },
      { method: "CARD", total: paise(10_000) },
      { method: "CASH", total: paise(60_000) },
    ]);
    expect(split).toEqual({ cash: 60_000n, online: 40_000n, cashBps: 6_000 });
  });

  it("has no share when nothing was captured", () => {
    expect(tillSplit([]).cashBps).toBeNull();
  });
});

describe("paymentsCsv", () => {
  it("writes rupees as plain decimals, quotes every cell and escapes quotes", () => {
    const csv = paymentsCsv([
      {
        orderNumber: "1042",
        channel: "Dine-in",
        status: "CAPTURED",
        method: "CASH",
        provider: "cash",
        amount: paise(280_050),
        feeAmount: paise(0),
        refunded: paise(0),
        capturedBy: 'Ravi "Counter" Singh',
        at: at("2026-09-14T09:30:00Z"),
      },
    ]);
    const [header, line] = csv.split("\n");
    expect(header).toContain('"Amount (INR)"');
    expect(line).toBe('"1042","Dine-in","Captured","Cash","cash","2800.50","0.00","0.00","Ravi ""Counter"" Singh","2026-09-14T09:30:00.000Z"');
  });
});
