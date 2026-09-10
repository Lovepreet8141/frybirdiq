"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Loader2 } from "lucide-react";
import { type CheckoutState, submitCheckout } from "@/lib/cart/checkout-action";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="flex min-h-[56px] w-full items-center justify-center gap-3 rounded-md bg-primary px-6 text-base font-semibold text-primary-foreground transition-opacity duration-[var(--duration-micro)] hover:opacity-90 disabled:opacity-50"
    >
      {pending ? (
        <>
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          Placing your order
        </>
      ) : (
        "Place order"
      )}
    </button>
  );
}

/**
 * Checkout. BUILD-PLAN.md §15.
 *
 * Deliberately short: §15 says not to create unnecessary steps, and this is a
 * collection order from a counter two minutes away. Name and phone are all the
 * shop needs to hand it over.
 *
 * Labels are visible, never placeholders — a placeholder disappears exactly
 * when the customer needs it. Errors sit beside the field they belong to.
 */
export function CheckoutForm() {
  const [state, action] = useActionState<CheckoutState, FormData>(submitCheckout, { status: "idle" });
  const fieldErrors = state.status === "error" ? (state.fieldErrors ?? {}) : {};

  return (
    <form action={action} className="flex flex-col gap-5">
      {state.status === "error" && !state.fieldErrors && (
        <p role="alert" className="rounded-md border border-border bg-surface px-4 py-3 text-sm leading-relaxed">
          {state.message}
        </p>
      )}

      <div className="flex flex-col gap-2">
        <label htmlFor="name" className="text-sm font-semibold">
          Name
        </label>
        <input
          id="name"
          name="name"
          required
          autoComplete="name"
          aria-invalid={Boolean(fieldErrors.name)}
          aria-describedby={fieldErrors.name ? "name-error" : undefined}
          className="h-[52px] rounded-md border border-border bg-surface px-4 text-base focus-visible:border-border-strong"
        />
        {fieldErrors.name && (
          <p id="name-error" role="alert" className="text-sm text-foreground">
            {fieldErrors.name}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor="phone" className="text-sm font-semibold">
          Mobile number
        </label>
        <input
          id="phone"
          name="phone"
          required
          type="tel"
          inputMode="numeric"
          autoComplete="tel-national"
          maxLength={10}
          aria-invalid={Boolean(fieldErrors.phone)}
          aria-describedby={fieldErrors.phone ? "phone-error" : "phone-hint"}
          className="h-[52px] rounded-md border border-border bg-surface px-4 text-base tabular focus-visible:border-border-strong"
        />
        {fieldErrors.phone ? (
          <p id="phone-error" role="alert" className="text-sm text-foreground">
            {fieldErrors.phone}
          </p>
        ) : (
          <p id="phone-hint" className="text-sm text-muted-foreground">
            So we can call you when it&rsquo;s ready.
          </p>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor="notes" className="text-sm font-semibold">
          Anything else <span className="font-normal text-muted-foreground">(optional)</span>
        </label>
        <textarea
          id="notes"
          name="notes"
          rows={3}
          maxLength={500}
          className="rounded-md border border-border bg-surface px-4 py-3 text-base focus-visible:border-border-strong"
        />
      </div>

      <SubmitButton />
    </form>
  );
}
