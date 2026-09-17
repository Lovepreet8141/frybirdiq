/**
 * fin-8: an expense can only reference its own org's category and account.
 * The app connects as `postgres`, which bypasses RLS, so a guessed id from
 * another tenant would otherwise attach a cost to one org's books that points
 * at the other's account. createExpense checks both inside the insert
 * transaction and refuses with one generic error.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { accounts, expenses } from "@/db/schema";
import { paise } from "@/lib/money";
import { ExpenseReferenceError, type NewExpense, createExpense } from "./expenses";
import { createTwoTestOrgs, seedExpenseCategory, type TwoOrgs } from "./__test-support__/iq-fixtures";

async function account(orgId: string): Promise<string> {
  const [row] = await db().insert(accounts).values({ orgId, name: "Till", kind: "CASH" }).returning({ id: accounts.id });
  if (!row) throw new Error("fixture: account insert returned no row");
  return row.id;
}

describe("createExpense — category and account belong to the org (fin-8)", () => {
  let orgs: TwoOrgs;
  let ownCategory: string;
  let ownAccount: string;
  let otherCategory: string;
  let otherAccount: string;

  const expense = (overrides: Partial<NewExpense>): NewExpense => ({
    categoryId: ownCategory,
    description: "Tenancy check",
    amount: paise(1_000n),
    paidOn: "2026-08-20",
    accountId: null,
    reference: null,
    ...overrides,
  });
  const expensesOfA = async () => db().select({ id: expenses.id, accountId: expenses.accountId }).from(expenses).where(eq(expenses.orgId, orgs.a.orgId));

  beforeAll(async () => {
    orgs = await createTwoTestOrgs();
    ownCategory = (await seedExpenseCategory(orgs.a, { behaviour: "DIRECT" })).id;
    otherCategory = (await seedExpenseCategory(orgs.b, { behaviour: "DIRECT" })).id;
    ownAccount = await account(orgs.a.orgId);
    otherAccount = await account(orgs.b.orgId);
  });

  afterAll(async () => {
    await orgs.cleanup();
  });

  it("refuses another org's account and writes nothing", async () => {
    await expect(createExpense(orgs.a.orgId, expense({ accountId: otherAccount }))).rejects.toBeInstanceOf(ExpenseReferenceError);
    expect(await expensesOfA()).toEqual([]);
  });

  it("refuses another org's category and writes nothing", async () => {
    await expect(createExpense(orgs.a.orgId, expense({ categoryId: otherCategory }))).rejects.toBeInstanceOf(ExpenseReferenceError);
    expect(await expensesOfA()).toEqual([]);
  });

  it("refuses an id that exists nowhere, with the same error", async () => {
    await expect(createExpense(orgs.a.orgId, expense({ accountId: "00000000-0000-4000-8000-000000000000" }))).rejects.toThrow(ExpenseReferenceError);
  });

  it("saves with the org's own category and account, or with no account", async () => {
    const withAccount = await createExpense(orgs.a.orgId, expense({ accountId: ownAccount }));
    const withoutAccount = await createExpense(orgs.a.orgId, expense({}));
    const rows = await expensesOfA();
    expect(rows).toHaveLength(2);
    expect(rows.find((row) => row.id === withAccount.id)?.accountId).toBe(ownAccount);
    expect(rows.find((row) => row.id === withoutAccount.id)?.accountId).toBeNull();
    expect(await db().select({ id: expenses.id }).from(expenses).where(and(eq(expenses.orgId, orgs.b.orgId)))).toEqual([]);
  });
});
