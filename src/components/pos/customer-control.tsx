"use client";

import { useState } from "react";
import { Gift, UserRound } from "lucide-react";
import { type PosCustomer, attachCustomerByPhone } from "./attach-customer";
import { RewardsKeypad } from "./rewards-keypad";

/**
 * "Customer" at the top of the till — available at any point in building an
 * order, not only on the tender step.
 *
 * A control, not a form field: one button when nobody is attached, a chip
 * (name, stamps, points, Change / Remove) once someone is. Tapping opens the
 * same keypad the tender uses, through the same lookup, into the same shell
 * state — so what is attached here is exactly what the tender shows and what
 * the order is placed against. Nothing is written until the order is placed.
 *
 * What a customer has that is usable — an unlocked stamp reward, points on
 * the balance — is said plainly. Redeeming it at the till is not built:
 * that is a discount on the sale, i.e. pricing, and gets its own approval.
 */
export function CustomerControl({
  customer,
  onChange,
  enabled,
}: {
  customer: PosCustomer | null;
  onChange: (customer: PosCustomer | null) => void;
  /** `customers.view` — whether the control is offered at all. */
  enabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  if (!enabled) return null;

  async function attach(phone: string): Promise<string | null> {
    const result = await attachCustomerByPhone(phone);
    if (!result.ok) return result.error;
    onChange(result.customer);
    setOpen(false);
    return null;
  }

  return (
    <div className="border-b border-border bg-surface p-3">
      {customer ? (
        <div className="flex items-center gap-2 rounded-md bg-surface-muted px-3 py-2 text-sm" role="status">
          <UserRound className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p className="truncate font-semibold">{customer.name ?? customer.phone}</p>
            <p className="truncate text-xs text-muted-foreground">
              {customer.summary}
              {customer.redeemable && (
                <span className="ml-1 inline-flex items-center gap-1 font-semibold text-foreground">
                  <Gift className="size-3" aria-hidden="true" />
                  {customer.redeemable.rewards > 0 ? "reward ready" : "points usable"}
                </span>
              )}
            </p>
          </div>
          <button type="button" onClick={() => setOpen(true)} className="min-h-[36px] rounded-md px-2 text-xs font-semibold underline underline-offset-2">
            Change
          </button>
          <button
            type="button"
            onClick={() => onChange(null)}
            aria-label="Remove customer from this order"
            className="min-h-[36px] rounded-md px-2 text-xs font-semibold text-muted-foreground underline underline-offset-2"
          >
            Remove
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-md border border-border text-sm font-semibold transition-colors hover:bg-surface-muted"
        >
          <UserRound className="size-4" aria-hidden="true" />
          Customer · add mobile
        </button>
      )}

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Customer — add mobile"
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4"
          onKeyDown={(event) => {
            if (event.key === "Escape") setOpen(false);
          }}
        >
          <div className="flex max-h-[92dvh] w-full max-w-md flex-col overflow-y-auto rounded-t-xl bg-background p-5 shadow-xl sm:rounded-xl">
            <RewardsKeypad onCancel={() => setOpen(false)} onSubmit={attach} />
          </div>
        </div>
      )}
    </div>
  );
}
