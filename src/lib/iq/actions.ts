"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import { expenseCategories, expenses, targets } from "@/db/schema";
import { getStaff, staffCan } from "@/lib/auth";
import { businessDate } from "@/lib/dates";
import { bps, fromRupees } from "@/lib/money";

export type ExpenseFormState = { status: "idle" } | { status: "error"; message: string };

/**
 * Amounts arrive as strings and stay strings until `fromRupees` parses them.
 * `Number("1234.50")` then multiplying by 100 is where money quietly loses a
 * paisa; the money module parses the decimal text directly instead.
 */
const expenseSchema = z.object({
  categoryId: z.uuid("Choose a category."),
  description: z.string().trim().min(1, "Say what this was for.").max(160),
  amount: z
    .string()
    .trim()
    .regex(/^\d+(\.\d{1,2})?$/, "Enter an amount like 2400 or 2400.50.")
    .refine((value) => Number(value) > 0, "An expense of zero is not worth recording."),
  paidOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a date."),
  accountId: z.string().uuid().optional().or(z.literal("")),
  reference: z.string().trim().max(80).optional(),
});

export async function recordExpense(
  _previous: ExpenseFormState,
  formData: FormData,
): Promise<ExpenseFormState> {
  const staff = await getStaff();
  if (!staff) return { status: "error", message: "Sign in to record an expense." };
  if (!(await staffCan("analytics.view"))) {
    return { status: "error", message: "You do not have access to the money side of FRYBIRD IQ." };
  }

  const parsed = expenseSchema.safeParse({
    categoryId: String(formData.get("categoryId") ?? ""),
    description: String(formData.get("description") ?? ""),
    amount: String(formData.get("amount") ?? ""),
    paidOn: String(formData.get("paidOn") ?? ""),
    accountId: String(formData.get("accountId") ?? ""),
    reference: String(formData.get("reference") ?? ""),
  });

  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "Check the form." };
  }

  // A date in the future is almost always a typo in the year, and it would sit
  // in a month that has not happened and quietly distort next month's P&L.
  if (parsed.data.paidOn > businessDate(new Date())) {
    return { status: "error", message: "That date is in the future." };
  }

  // The category has to belong to this organization. Without the check, a
  // guessed id from another tenant would attach a cost to their books.
  const category = await db()
    .select({ id: expenseCategories.id })
    .from(expenseCategories)
    .where(and(eq(expenseCategories.id, parsed.data.categoryId), eq(expenseCategories.orgId, staff.orgId)))
    .limit(1);
  if (category.length === 0) {
    return { status: "error", message: "That category no longer exists." };
  }

  await db()
    .insert(expenses)
    .values({
      orgId: staff.orgId,
      categoryId: parsed.data.categoryId,
      description: parsed.data.description,
      amount: fromRupees(parsed.data.amount),
      paidOn: parsed.data.paidOn,
      accountId: parsed.data.accountId ? parsed.data.accountId : null,
      reference: parsed.data.reference || null,
    });

  revalidatePath("/app/iq/expenses");
  revalidatePath("/app/iq/pnl");
  revalidatePath("/app/iq");
  redirect("/app/iq/expenses?saved=1");
}

const targetSchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/, "Choose a month."),
  foodCostPct: z
    .string()
    .trim()
    .regex(/^\d{1,2}(\.\d)?$/, "Enter a percentage like 32 or 32.5.")
    .refine((v) => Number(v) > 0 && Number(v) < 100, "A food cost target has to sit between 0 and 100."),
});

export async function setFoodCostTarget(
  _previous: ExpenseFormState,
  formData: FormData,
): Promise<ExpenseFormState> {
  const staff = await getStaff();
  if (!staff) return { status: "error", message: "Sign in first." };
  if (!(await staffCan("analytics.view"))) {
    return { status: "error", message: "You do not have access to targets." };
  }

  const parsed = targetSchema.safeParse({
    month: String(formData.get("month") ?? ""),
    foodCostPct: String(formData.get("foodCostPct") ?? ""),
  });
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "Check the form." };
  }

  const month = `${parsed.data.month}-01`;
  const foodCostTargetBps = bps(Number(parsed.data.foodCostPct));

  await db()
    .insert(targets)
    .values({ orgId: staff.orgId, month, foodCostTargetBps })
    .onConflictDoUpdate({
      target: [targets.orgId, targets.month],
      set: { foodCostTargetBps, updatedAt: new Date() },
    });

  revalidatePath("/app/iq/pnl");
  return { status: "idle" };
}
