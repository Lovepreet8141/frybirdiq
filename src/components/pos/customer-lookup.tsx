"use client";

import { Search, User } from "lucide-react";
import { useState, useTransition } from "react";
import { type CustomerLookupFail, type CustomerLookupResult, lookupCustomerAction } from "@/lib/pos/actions";

/**
 * Look a regular up by phone before ringing them up.
 *
 * Read-only: it shows what the customer already has — name, FRYBIRD REWARDS
 * progress — through the same ledger the website reads
 * (`getStampAccountState`), never a second loyalty system for the counter.
 * There is nowhere yet for this lookup to feed into an order — the POS
 * cannot place one yet — so this is purely informational ahead of that
 * piece landing.
 */
export function CustomerLookup() {
  const [phone, setPhone] = useState("");
  const [result, setResult] = useState<CustomerLookupResult | CustomerLookupFail | null>(null);
  const [isPending, startTransition] = useTransition();

  function lookup() {
    startTransition(async () => {
      setResult(await lookupCustomerAction(phone));
    });
  }

  return (
    <div className="border-b border-border bg-surface p-3">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          lookup();
        }}
        className="flex items-center gap-2"
      >
        <label htmlFor="pos-customer-phone" className="sr-only">
          Customer phone number
        </label>
        <input
          id="pos-customer-phone"
          type="tel"
          inputMode="numeric"
          value={phone}
          onChange={(event) => setPhone(event.target.value.replace(/\D/g, "").slice(0, 10))}
          placeholder="Customer's phone number"
          className="h-[40px] flex-1 rounded-md border border-border bg-background px-3 text-sm"
        />
        <button
          type="submit"
          disabled={isPending || phone.length !== 10}
          className="flex h-[40px] items-center gap-1.5 rounded-md bg-primary px-3 text-sm font-semibold text-primary-foreground disabled:opacity-50"
        >
          <Search className="size-4" aria-hidden="true" />
          {isPending ? "Looking up…" : "Look up"}
        </button>
      </form>

      {result && !result.ok && (
        <p role="status" className="mt-2 text-sm text-muted-foreground">
          {result.error}
        </p>
      )}

      {result && result.ok && (
        <div role="status" className="mt-2 flex items-center gap-2 rounded-md bg-surface-muted px-3 py-2 text-sm">
          <User className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="font-semibold">{result.name ?? result.phone}</span>
          {result.rewards ? (
            <span className="tabular text-muted-foreground">
              {result.rewards.availableRewardCount > 0
                ? `${result.rewards.availableRewardCount} reward${result.rewards.availableRewardCount > 1 ? "s" : ""} ready`
                : `${result.rewards.stampCount}/${result.rewards.stampsRequired} stamps`}
            </span>
          ) : (
            <span className="text-muted-foreground">No FRYBIRD REWARDS activity yet</span>
          )}
        </div>
      )}
    </div>
  );
}
