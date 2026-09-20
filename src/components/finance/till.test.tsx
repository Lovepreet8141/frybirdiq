import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// The forms call server actions; rendering them needs none of the server code behind them.
vi.mock("@/lib/cash/actions", () => ({
  openCashSessionAction: async () => ({ status: "idle" }),
  closeCashSessionAction: async () => ({ status: "idle" }),
  recordCashHandoverAction: async () => ({ status: "idle" }),
}));

import { fromRupees, paise } from "@/lib/money";
import type { ReconciliationDay } from "@/lib/repositories/cash-sessions";
import { ReconciliationTable } from "./reconciliation-table";
import { TillPanel, type TillSessionRow } from "./till-panel";

const open: TillSessionRow = { id: "s1", openedAt: "2026-09-20T05:00:00Z", openedBy: "Asha", openingFloat: fromRupees("2000"), cashPaymentCount: 7, closedAt: null, closedBy: null, countedCash: null, expectedCash: null, variance: null, note: null };
const closed: TillSessionRow = { ...open, id: "s0", closedAt: "2026-09-19T17:00:00Z", closedBy: "Ravi", countedCash: fromRupees("2980"), expectedCash: fromRupees("3000"), variance: fromRupees("-20") };

describe("TillPanel", () => {
  it("open till: shows who opened it, the float and the payment COUNT, but never the expected amount (the count stays blind)", () => {
    const html = renderToStaticMarkup(<TillPanel open={open} recent={[]} riders={[]} canManage />);
    expect(html).toContain("Till is open");
    expect(html).toContain("₹2,000");
    expect(html).toContain("Asha");
    expect(html).toContain("Close the till");
    expect(html).toContain("shown after you close it");
    expect(html).not.toMatch(/expected ₹|Expected/);
  });

  it("no till: an open form for someone who can manage, plain words for someone who cannot", () => {
    expect(renderToStaticMarkup(<TillPanel open={null} recent={[]} riders={[]} canManage />)).toContain("Open the till");
    const readOnly = renderToStaticMarkup(<TillPanel open={null} recent={[]} riders={[]} canManage={false} />);
    expect(readOnly).toContain("needs the finance permission");
    expect(readOnly).not.toContain("Open the till</button>");
  });

  it("a closed till shows counted, expected and the variance in words, against who closed it", () => {
    const html = renderToStaticMarkup(<TillPanel open={null} recent={[closed]} riders={[]} canManage />);
    expect(html).toContain("closed by Ravi");
    expect(html).toContain("Counted ₹2,980, expected ₹3,000");
    expect(html).toContain("₹20 short");
  });

  it("rider door cash: who carries how much from how many deliveries, and a receive form only while a till is open", () => {
    const rider = { riderUserId: "r1", riderName: "Vikram", paymentCount: 2, amount: fromRupees("800"), since: "2026-09-20T06:00:00Z" };
    const withTill = renderToStaticMarkup(<TillPanel open={open} recent={[]} riders={[rider]} canManage />);
    expect(withTill).toContain("Vikram");
    expect(withTill).toContain("carrying ₹800 from 2 deliveries");
    expect(withTill).toContain("Receive it");
    const noTill = renderToStaticMarkup(<TillPanel open={null} recent={[]} riders={[rider]} canManage />);
    expect(noTill).toContain("Open the till to receive this cash");
    expect(noTill).not.toContain("Receive it");
    expect(renderToStaticMarkup(<TillPanel open={null} recent={[]} riders={[]} canManage />)).toContain("Every rider has handed over");
  });
});

describe("ReconciliationTable", () => {
  const day: ReconciliationDay = {
    date: "2026-09-20", cashInTill: fromRupees("400"), cashUnassigned: fromRupees("100"), cashWithRiders: fromRupees("250"), cashRefunded: fromRupees("30"),
    onlineCaptured: fromRupees("600"), onlineRefunded: paise(0), net: fromRupees("1320"), sessionsClosed: 1, counted: fromRupees("1390"), expected: fromRupees("1370"), variance: fromRupees("20"),
  };
  it("one card per day with every pile named, the net, and the tills' variance in words", () => {
    const html = renderToStaticMarkup(<ReconciliationTable days={[day]} openSession={false} periodLabel="Today" />);
    for (const text of ["Net ₹1,320", "Cash in a till", "Cash not in any till", "Cash a rider still carries", "Online (provider)", "Refunded in cash", "counted ₹1,390, expected ₹1,370: ₹20 over"]) expect(html).toContain(text);
    expect(html).toContain("not connected yet");
  });
  it("says so when nothing moved, and when a till is still open", () => {
    expect(renderToStaticMarkup(<ReconciliationTable days={[]} openSession={false} periodLabel="Today" />)).toContain("No money moved today.");
    expect(renderToStaticMarkup(<ReconciliationTable days={[{ ...day, sessionsClosed: 0 }]} openSession periodLabel="Today" />)).toContain("A till is open now");
  });
});
