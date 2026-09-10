"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { type ExpenseFormState, recordExpense } from "@/lib/iq/actions";

interface Option {
  id: string;
  name: string;
}
interface CategoryOption extends Option {
  behaviour: "DIRECT" | "FIXED";
}

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex min-h-[44px] items-center rounded-md bg-primary px-5 text-sm font-semibold text-primary-foreground disabled:opacity-60"
    >
      {pending ? "Saving…" : "Record expense"}
    </button>
  );
}

export function ExpenseForm({
  categories,
  accounts,
  today,
}: {
  categories: CategoryOption[];
  accounts: Option[];
  today: string;
}) {
  const [state, action] = useActionState<ExpenseFormState, FormData>(recordExpense, { status: "idle" });

  const direct = categories.filter((c) => c.behaviour === "DIRECT");
  const fixed = categories.filter((c) => c.behaviour === "FIXED");

  return (
    <form action={action} className="mt-8 flex max-w-lg flex-col gap-5">
      {state.status === "error" && (
        <p role="alert" className="border-l-2 border-[var(--destructive)] bg-surface px-4 py-3 text-sm">
          {state.message}
        </p>
      )}

      <div className="flex flex-col gap-1.5">
        <label htmlFor="amount" className="text-sm font-semibold">
          Amount
        </label>
        <div className="flex items-center gap-2">
          <span aria-hidden="true" className="text-lg text-muted-foreground">₹</span>
          <input
            id="amount"
            name="amount"
            required
            inputMode="decimal"
            placeholder="2400"
            autoComplete="off"
            className="tabular w-full min-h-[44px] w-full rounded-md border border-border bg-surface px-3 py-2.5 text-lg"
          />
        </div>
        <p className="text-xs text-muted-foreground">Rupees. Paise are fine — 2400.50.</p>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="categoryId" className="text-sm font-semibold">
          Category
        </label>
        <select
          id="categoryId"
          name="categoryId"
          required
          defaultValue=""
          className="w-full min-h-[44px] w-full rounded-md border border-border bg-surface px-3 py-2.5"
        >
          <option value="" disabled>
            Choose a category
          </option>
          {/* Grouped by behaviour so the split that drives break-even is
              visible at the moment of entry, not buried in a settings page. */}
          <optgroup label="Moves with sales">
            {direct.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </optgroup>
          <optgroup label="Same whether you open or not">
            {fixed.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </optgroup>
        </select>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="description" className="text-sm font-semibold">
          What was it for
        </label>
        <input
          id="description"
          name="description"
          required
          maxLength={160}
          placeholder="Chicken from Metro, 20 kg"
          className="w-full min-h-[44px] w-full rounded-md border border-border bg-surface px-3 py-2.5"
        />
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="paidOn" className="text-sm font-semibold">
            Date paid
          </label>
          <input
            id="paidOn"
            name="paidOn"
            type="date"
            required
            defaultValue={today}
            max={today}
            className="tabular w-full min-h-[44px] w-full rounded-md border border-border bg-surface px-3 py-2.5"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="accountId" className="text-sm font-semibold">
            Paid from <span className="font-normal text-muted-foreground">(optional)</span>
          </label>
          <select
            id="accountId"
            name="accountId"
            defaultValue=""
            className="w-full min-h-[44px] w-full rounded-md border border-border bg-surface px-3 py-2.5"
          >
            <option value="">Not recorded</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="reference" className="text-sm font-semibold">
          Bill number <span className="font-normal text-muted-foreground">(optional)</span>
        </label>
        <input
          id="reference"
          name="reference"
          maxLength={80}
          className="w-full min-h-[44px] w-full rounded-md border border-border bg-surface px-3 py-2.5"
        />
      </div>

      <div className="flex items-center gap-3 pt-1">
        <Submit />
      </div>
    </form>
  );
}
