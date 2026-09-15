"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { type SettingsFormState, updatePaymentSettingsAction } from "@/lib/settings/actions";
import { Field, inputClass } from "@/components/inventory/field";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="inline-flex min-h-[44px] items-center rounded-md bg-primary px-5 text-sm font-semibold text-primary-foreground disabled:opacity-60">
      {pending ? "Saving…" : "Save payment settings"}
    </button>
  );
}

/**
 * COD cap and which payment methods checkout offers. Roadmap 5.5.
 *
 * `cashEnabled`/`onlineEnabled` sit on top of whether Razorpay is actually
 * configured (`availableMethods()` in `src/lib/payments`) — switching
 * online on here does nothing until the gateway has keys; switching it off
 * here hides it even when the gateway is ready. The action refuses to save
 * both switches off, so this form cannot leave checkout with nothing to
 * offer.
 */
export function PaymentSettingsForm({ codCapRupees, cashEnabled, onlineEnabled }: { codCapRupees: number; cashEnabled: boolean; onlineEnabled: boolean }) {
  const [state, action] = useActionState<SettingsFormState, FormData>(updatePaymentSettingsAction, { status: "idle" });

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
      <Field id="pay-cod-cap" label="COD cap (₹)" hint="Orders over this are paid online instead — only bites once online payment exists.">
        <input id="pay-cod-cap" name="codCap" type="number" inputMode="numeric" min={1} max={100_000} step={1} required defaultValue={codCapRupees} className={inputClass} />
      </Field>
      <div className="flex flex-col gap-3">
        <label className="flex items-center gap-2.5 text-sm font-medium">
          <input type="checkbox" name="cashEnabled" defaultChecked={cashEnabled} className="size-4 rounded border-border accent-primary" />
          Cash — at the counter, or at the door
        </label>
        <label className="flex items-center gap-2.5 text-sm font-medium">
          <input type="checkbox" name="onlineEnabled" defaultChecked={onlineEnabled} className="size-4 rounded border-border accent-primary" />
          Online — UPI, card, net banking (needs Razorpay configured)
        </label>
      </div>
      <div className="flex justify-end">
        <Submit />
      </div>
    </form>
  );
}
