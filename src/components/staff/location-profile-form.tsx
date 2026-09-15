"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { type SettingsFormState, updateLocationProfileAction } from "@/lib/settings/actions";
import { Field, inputClass } from "@/components/inventory/field";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="inline-flex min-h-[44px] items-center rounded-md bg-primary px-5 text-sm font-semibold text-primary-foreground disabled:opacity-60">
      {pending ? "Saving…" : "Save location"}
    </button>
  );
}

/**
 * The outlet's address and phone. Roadmap 5.5.
 *
 * GST state and state code are deliberately not here — they decide
 * CGST+SGST versus IGST on every order billed at this outlet, which is a
 * tax-adjacent fact this slice leaves alone, same as GSTIN.
 */
export function LocationProfileForm({
  addressLine1,
  addressLine2,
  city,
  pincode,
  phone,
}: {
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  pincode: string | null;
  phone: string | null;
}) {
  const [state, action] = useActionState<SettingsFormState, FormData>(updateLocationProfileAction, { status: "idle" });

  return (
    <form action={action} className="flex flex-col gap-4 rounded-lg border border-border p-4">
      {state.status === "error" && (
        <p role="alert" className="border-l-2 border-[var(--destructive)] bg-surface px-4 py-3 text-sm">
          {state.message}
        </p>
      )}
      {state.status === "success" && (
        <p role="status" className="border-l-2 border-[var(--success)] bg-surface px-4 py-3 text-sm">
          {state.message}
        </p>
      )}
      <Field id="loc-address1" label="Address line 1" hint="House, shop or street.">
        <input id="loc-address1" name="addressLine1" type="text" required maxLength={200} defaultValue={addressLine1 ?? ""} className={inputClass} />
      </Field>
      <Field id="loc-address2" label="Address line 2" hint="Optional.">
        <input id="loc-address2" name="addressLine2" type="text" maxLength={200} defaultValue={addressLine2 ?? ""} className={inputClass} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="loc-city" label="City">
          <input id="loc-city" name="city" type="text" required maxLength={80} defaultValue={city ?? ""} className={inputClass} />
        </Field>
        <Field id="loc-pincode" label="PIN code">
          <input id="loc-pincode" name="pincode" type="text" inputMode="numeric" required pattern="\d{6}" maxLength={6} defaultValue={pincode ?? ""} className={inputClass} />
        </Field>
      </div>
      <Field id="loc-phone" label="Phone" hint="The number customers and delivery riders call.">
        <input id="loc-phone" name="phone" type="tel" required maxLength={20} defaultValue={phone ?? ""} className={inputClass} />
      </Field>
      <div className="flex justify-end">
        <Submit />
      </div>
    </form>
  );
}
