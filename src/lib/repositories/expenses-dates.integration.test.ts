/**
 * Expenses and targets are read by IST business date — defect D4.
 *
 * `paid_on` and `targets.month` are calendar dates in Ambala. A business
 * range's `from` is midnight IST expressed in UTC — 18:30 the day before —
 * so narrowing it with `toISOString().slice` put 31 August inside
 * September's P&L, read August's food-cost target for September, and made
 * a one-day range cover two expense days. These cases pin the IST reading.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/db";
import { expenseCategories, expenses, targets } from "@/db/schema";
import { endOfBusinessDay, startOfBusinessDay, type DateRange } from "@/lib/dates";
import { paise } from "@/lib/money";
import { expenseTotals, getProfitAndLoss, listExpenses, monthTarget } from "./expenses";
import { createTestOrg, deleteTestOrg, type TestOrg } from "./__test-support__/fixtures";

const AUG_31 = "2026-08-31";
const SEP_01 = "2026-09-01";

const day = (date: string): DateRange => ({ from: startOfBusinessDay(date), to: endOfBusinessDay(date), label: date });
const september: DateRange = { from: startOfBusinessDay("2026-09-01"), to: endOfBusinessDay("2026-09-30"), label: "September 2026" };
const august: DateRange = { from: startOfBusinessDay("2026-08-01"), to: endOfBusinessDay("2026-08-31"), label: "August 2026" };

async function seed(org: TestOrg, amounts: { aug31: bigint; sep01: bigint }, targetBps: { aug: number; sep: number }) {
  const [category] = await db()
    .insert(expenseCategories)
    .values({ orgId: org.orgId, name: "Chicken", behaviour: "DIRECT" })
    .returning({ id: expenseCategories.id });
  if (!category) throw new Error("fixture: category insert returned no row");

  await db()
    .insert(expenses)
    .values([
      { orgId: org.orgId, categoryId: category.id, description: "Chicken 31 Aug", amount: paise(amounts.aug31), paidOn: AUG_31 },
      { orgId: org.orgId, categoryId: category.id, description: "Chicken 1 Sep", amount: paise(amounts.sep01), paidOn: SEP_01 },
    ]);
  await db()
    .insert(targets)
    .values([
      { orgId: org.orgId, month: "2026-08-01", foodCostTargetBps: targetBps.aug },
      { orgId: org.orgId, month: "2026-09-01", foodCostTargetBps: targetBps.sep },
    ]);
}

describe("expenses — IST business dates (D4)", () => {
  let org: TestOrg;
  let other: TestOrg;

  beforeAll(async () => {
    org = await createTestOrg();
    other = await createTestOrg();
    await seed(org, { aug31: 11_100n, sep01: 22_200n }, { aug: 3000, sep: 3500 });
    // A second org with different figures on the same dates: nothing of it may leak in.
    await seed(other, { aug31: 99_900n, sep01: 88_800n }, { aug: 1000, sep: 1500 });
  });

  afterAll(async () => {
    await deleteTestOrg(org.orgId);
    await deleteTestOrg(other.orgId);
  });

  it("September's expense totals include 1 Sep and not 31 Aug", async () => {
    const totals = await expenseTotals(org.orgId, september);
    expect(totals.map((t) => t.amount)).toEqual([22_200n]);
  });

  it("August's expense totals include 31 Aug and not 1 Sep", async () => {
    const totals = await expenseTotals(org.orgId, august);
    expect(totals.map((t) => t.amount)).toEqual([11_100n]);
  });

  it("September lists only the 1 Sep expense", async () => {
    const rows = await listExpenses(org.orgId, september);
    expect(rows.map((r) => r.paidOn)).toEqual([SEP_01]);
  });

  it("September reads September's food-cost target, August reads August's", async () => {
    expect(await monthTarget(org.orgId, september)).toBe(3500);
    expect(await monthTarget(org.orgId, august)).toBe(3000);
  });

  it("a one-day range covers exactly one expense day", async () => {
    expect((await listExpenses(org.orgId, day(SEP_01))).map((r) => r.paidOn)).toEqual([SEP_01]);
    expect((await listExpenses(org.orgId, day(AUG_31))).map((r) => r.paidOn)).toEqual([AUG_31]);
    expect((await expenseTotals(org.orgId, day(SEP_01))).map((t) => t.amount)).toEqual([22_200n]);
  });

  it("the September P&L carries only September's direct cost and target, scoped to its org", async () => {
    const pnl = await getProfitAndLoss(org.orgId, september);
    expect(pnl.direct.map((t) => t.amount)).toEqual([22_200n]);
    expect(pnl.foodCostTargetBps).toBe(3500);

    const otherPnl = await getProfitAndLoss(other.orgId, september);
    expect(otherPnl.direct.map((t) => t.amount)).toEqual([88_800n]);
    expect(otherPnl.foodCostTargetBps).toBe(1500);
  });
});
