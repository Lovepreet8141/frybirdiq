"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { type ExpenseFormState, recordExpense } from "@/lib/iq/actions";

interface Option {
  id: string;
  name: string;
}
interface CategoryOption extends Option {
  behaviour: "DIRECT" | "FIXED";
}

const selectClassName =
  "h-10 w-full min-w-0 rounded-md border border-input bg-panel px-3 py-1 text-base text-foreground transition-[border-color,box-shadow] duration-[120ms] outline-none focus-visible:border-primary focus-visible:ring-[3px] focus-visible:ring-primary/20 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-60 md:text-sm";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} size="lg" className="min-h-11">
      {pending ? "Saving…" : "Record expense"}
    </Button>
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
    <form action={action} className="flex max-w-lg flex-col gap-5">
      {state.status === "error" && (
        <p role="alert" className="rounded-md border-l-2 border-loss bg-loss-soft/60 px-4 py-3 text-sm">
          {state.message}
        </p>
      )}

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="amount" className="text-[13px] font-semibold">
          Amount
        </Label>
        <div className="flex items-center gap-2">
          <span aria-hidden="true" className="text-lg text-muted-foreground">₹</span>
          <Input
            id="amount"
            name="amount"
            required
            inputMode="decimal"
            placeholder="2400"
            autoComplete="off"
            className="tabular text-lg"
          />
        </div>
        <p className="text-[12.5px] text-muted-foreground">Rupees. Paise are fine — 2400.50.</p>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="categoryId" className="text-[13px] font-semibold">
          Category
        </Label>
        <select id="categoryId" name="categoryId" required defaultValue="" className={selectClassName}>
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
        <Label htmlFor="description" className="text-[13px] font-semibold">
          What was it for
        </Label>
        <Input id="description" name="description" required maxLength={160} placeholder="Chicken from Metro, 20 kg" />
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="paidOn" className="text-[13px] font-semibold">
            Date paid
          </Label>
          <Input id="paidOn" name="paidOn" type="date" required defaultValue={today} max={today} className="tabular" />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="accountId" className="text-[13px] font-semibold">
            Paid from <span className="font-normal text-muted-foreground">(optional)</span>
          </Label>
          <select id="accountId" name="accountId" defaultValue="" className={selectClassName}>
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
        <Label htmlFor="reference" className="text-[13px] font-semibold">
          Bill number <span className="font-normal text-muted-foreground">(optional)</span>
        </Label>
        <Input id="reference" name="reference" maxLength={80} />
      </div>

      <div className="flex items-center gap-3 pt-1">
        <Submit />
      </div>
    </form>
  );
}
