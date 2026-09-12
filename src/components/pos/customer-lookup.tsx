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
 * A match is handed up to the shell so the order being built is attached to
 * that customer — the phone travels, never the customer id, so the server
 * resolves it against this org itself rather than trusting a screen. No
 * discount is applied here; a reward is still redeemed the way every other
 * channel redeems one.
 */
export function CustomerLookup({ onCustomer }: { onCustomer: (customer: { phone: string; name: string | null } | null) => void }) {
  const [phone, setPhone] = useState("");
  const [result, setResult] = useState<CustomerLookupResult | CustomerLookupFail | null>(null);
  const [isPending, startTransition] = useTransition();

  function lookup() {
    startTransition(async () => {
      const found = await lookupCustomerAction(phone);
      setResult(found);
      onCustomer(found.ok ? { phone: found.phone, name: found.name } : null);
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
          onChange={(event) => {
            setPhone(event.target.value.replace(/\D/g, "").slice(0, 10));
            // Editing the number drops the match it produced: an order must
            // never stay attached to a customer the cashier has moved off.
            setResult(null);
            onCustomer(null);
          }}
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
