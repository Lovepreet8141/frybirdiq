"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { Bike, CreditCard, Loader2, Store, Wallet } from "lucide-react";
import { type CheckoutState, submitCheckout } from "@/lib/cart/checkout-action";
import { DeliveryFields, type SavedAddressOption } from "@/components/delivery/delivery-fields";
import type { Point } from "@/components/delivery/map";
import type { CheckoutMethod } from "@/lib/payments";
import { cn } from "@/lib/utils";

function SubmitButton({ label }: { label: string }) {
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
        label
      )}
    </button>
  );
}

/**
 * Checkout. BUILD-PLAN.md §15, §17.
 *
 * Deliberately short: §15 says not to create unnecessary steps, and this is a
 * collection order from a counter two minutes away. Name and phone are all the
 * shop needs to hand it over.
 *
 * Labels are visible, never placeholders — a placeholder disappears exactly
 * when the customer needs it. Errors sit beside the field they belong to.
 */
export function CheckoutForm({
  idempotencyKey,
  shop,
  deliveryEnabled,
  savedAddresses,
  contact,
  fromAccount,
  extras,
  methods,
}: {
  idempotencyKey: string;
  /** Where the outlet is. Null when it has not been placed on the map. */
  shop: Point | null;
  deliveryEnabled: boolean;
  /** Addresses this customer has used before. */
  savedAddresses: SavedAddressOption[];
  /** Who is ordering, when we already know. */
  contact: { name: string; phone: string; email: string } | null;
  /** True when those details come from a signed-in account. */
  fromAccount: boolean;
  /** Code, points and note — rendered by the page, kept out of this form's job. */
  extras: React.ReactNode;
  /** What the server offers, online first when a gateway is set up. */
  methods: readonly CheckoutMethod[];
}) {
  const [payment, setPayment] = useState<"COD" | "ONLINE">(methods[0]?.choice ?? "COD");
  const [fulfilment, setFulfilment] = useState<"TAKEAWAY" | "DELIVERY">("TAKEAWAY");
  /*
   * Someone we already know is not asked again.
   *
   * Their details are shown as a line to confirm, with the fields collapsed
   * behind "Change". Three pre-filled inputs still read as a form to fill in;
   * a sentence reads as something already done.
   */
  const [editingContact, setEditingContact] = useState(contact === null);
  const [state, action] = useActionState<CheckoutState, FormData>(submitCheckout, { status: "idle" });
  const fieldErrors = state.status === "error" ? (state.fieldErrors ?? {}) : {};

  return (
    <form action={action} className="flex flex-col gap-5">
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      <input type="hidden" name="fulfilment" value={fulfilment} />
      <input type="hidden" name="payment" value={payment} />

      {/*
        Collection or delivery. Rendered as a choice only when delivery is
        actually configured — offering it and then refusing every pin would be
        worse than not offering it.
      */}
      {deliveryEnabled && shop && (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-sm font-semibold">How would you like it?</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {[
              { value: "TAKEAWAY" as const, icon: Store, label: "Collect", detail: "From Sector 9" },
              { value: "DELIVERY" as const, icon: Bike, label: "Deliver", detail: "Charged by distance" },
            ].map((option) => (
              <label
                key={option.value}
                className={cn(
                  "flex min-h-[56px] cursor-pointer items-center gap-3 rounded-md border px-4 py-3 transition-colors duration-[var(--duration-micro)]",
                  fulfilment === option.value
                    ? "border-primary bg-primary/10"
                    : "border-border bg-surface hover:border-border-strong",
                )}
              >
                <input
                  type="radio"
                  name="fulfilmentChoice"
                  value={option.value}
                  checked={fulfilment === option.value}
                  onChange={() => setFulfilment(option.value)}
                  className="size-4 accent-[var(--primary)]"
                />
                <option.icon className="size-4 shrink-0 text-primary" aria-hidden="true" />
                <span className="flex flex-col">
                  <span className="font-semibold">{option.label}</span>
                  <span className="text-sm text-muted-foreground">{option.detail}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      )}

      {fulfilment === "DELIVERY" && shop && <DeliveryFields shop={shop} saved={savedAddresses} />}
      {state.status === "error" && !state.fieldErrors && (
        <p role="alert" className="rounded-md border border-border bg-surface px-4 py-3 text-sm leading-relaxed">
          {state.message}
        </p>
      )}

      {!editingContact && contact ? (
        <div className="flex flex-wrap items-start justify-between gap-3 rounded-md border border-border bg-surface px-4 py-3">
          <div className="flex min-w-0 flex-col">
            <span className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
              {fromAccount ? "Ordering as" : "Last time you ordered as"}
            </span>
            <span className="font-semibold">{contact.name}</span>
            <span className="tabular text-sm text-muted-foreground">
              {contact.phone} · {contact.email}
            </span>
          </div>

          <button
            type="button"
            onClick={() => setEditingContact(true)}
            className="flex min-h-[44px] items-center rounded-md border border-border px-3 text-sm font-semibold transition-colors hover:bg-surface-muted"
          >
            Change
          </button>

          {/* Submitted either way; the server validates them exactly as it
              would freshly typed ones. */}
          <input type="hidden" name="name" value={contact.name} />
          <input type="hidden" name="phone" value={contact.phone} />
          <input type="hidden" name="email" value={contact.email} />
        </div>
      ) : (
        <>
          <div className="flex flex-col gap-2">
            <label htmlFor="name" className="text-sm font-semibold">
              Name
            </label>
            <input
              id="name"
              name="name"
              required
              autoComplete="name"
              defaultValue={contact?.name ?? ""}
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
              defaultValue={contact?.phone ?? ""}
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
            <label htmlFor="email" className="text-sm font-semibold">
              Email
            </label>
            <input
              id="email"
              name="email"
              required
              type="email"
              autoComplete="email"
              autoCapitalize="none"
              defaultValue={contact?.email ?? ""}
              aria-invalid={Boolean(fieldErrors.email)}
              aria-describedby={fieldErrors.email ? "email-error" : "email-hint"}
              className="h-[52px] rounded-md border border-border bg-surface px-4 text-base focus-visible:border-border-strong"
            />
            {fieldErrors.email ? (
              <p id="email-error" role="alert" className="text-sm text-foreground">
                {fieldErrors.email}
              </p>
            ) : (
              <p id="email-hint" className="text-sm text-muted-foreground">
                For your receipt.
              </p>
            )}
          </div>
        </>
      )}

      {/*
        Marketing consent. Unticked, and separate from placing the order.
        An order is permission to fulfil an order; advertising later is a
        different purpose and needs its own consent. A pre-ticked box is the
        dark pattern §30 rules out, and it would not be consent anyway.
      */}
      <label className="flex cursor-pointer items-center gap-3 text-sm">
        <input type="checkbox" name="marketingConsent" className="size-4 shrink-0 accent-[var(--primary)]" />
        <span className="text-muted-foreground">
          Send me FRYBIRD offers. Not needed to order.
        </span>
      </label>

      {/*
        How to pay. A choice only when there is one — with cash alone the
        page says so as a line, not a fieldset. Online first: it is what the
        counter would rather have, and what the COD cap steers big orders to.
      */}
      {methods.length > 1 && (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-sm font-semibold">How will you pay?</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {methods.map((option) => {
              const Icon = option.choice === "ONLINE" ? CreditCard : Wallet;
              return (
                <label
                  key={option.choice}
                  className={cn(
                    "flex min-h-[56px] cursor-pointer items-center gap-3 rounded-md border px-4 py-3 transition-colors duration-[var(--duration-micro)]",
                    payment === option.choice ? "border-primary bg-primary/10" : "border-border bg-surface hover:border-border-strong",
                  )}
                >
                  <input type="radio" name="paymentChoice" value={option.choice} checked={payment === option.choice} onChange={() => setPayment(option.choice)} className="size-4 accent-[var(--primary)]" />
                  <Icon className="size-4 shrink-0 text-primary" aria-hidden="true" />
                  <span className="flex flex-col">
                    <span className="font-semibold">{option.label}</span>
                    <span className="text-sm text-muted-foreground">{option.detail}</span>
                  </span>
                </label>
              );
            })}
          </div>
          {fieldErrors.payment && (
            <p role="alert" className="text-sm text-foreground">
              {fieldErrors.payment}
            </p>
          )}
        </fieldset>
      )}

      {extras}

      <SubmitButton label={payment === "ONLINE" ? "Continue to payment" : "Place order"} />
    </form>
  );
}
