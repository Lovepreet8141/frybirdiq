"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { type OperationsSettingsState, updateRiderLimitsAction } from "@/lib/settings/actions";
import { RIDER_LIMIT_BOUNDS } from "@/lib/delivery/hold";
import { Field, inputClass } from "@/components/inventory/field";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="inline-flex min-h-[44px] items-center rounded-md bg-primary px-5 text-sm font-semibold text-primary-foreground disabled:opacity-60">
      {pending ? "Saving…" : "Save rider limits"}
    </button>
  );
}

/** How many deliveries one rider may hold at once, and how many they may take in an hour. Bounded: the take cap protects customers' details. */
export function RiderLimitsForm({ maxActive, maxTakesPerHour }: { maxActive: number; maxTakesPerHour: number }) {
  const [state, action] = useActionState<OperationsSettingsState, FormData>(updateRiderLimitsAction, { status: "idle" });
  const b = RIDER_LIMIT_BOUNDS;

  return (
    <form action={action} className="flex flex-col gap-4 rounded-lg border border-border p-4" data-rider-limits="">
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
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="rider-max-active" label="Deliveries a rider can hold at once" hint={`Ready or on the road. ${b.activeMin} to ${b.activeMax}. A manager can still assign more by hand.`}>
          <input id="rider-max-active" name="riderMaxActive" type="number" inputMode="numeric" min={b.activeMin} max={b.activeMax} step={1} required defaultValue={maxActive} className={inputClass} />
        </Field>
        <Field id="rider-max-takes" label="Takes per hour" hint={`Taking shows a customer's name, phone and address, so it is capped. ${b.takesMin} to ${b.takesMax}.`}>
          <input id="rider-max-takes" name="riderMaxTakesPerHour" type="number" inputMode="numeric" min={b.takesMin} max={b.takesMax} step={1} required defaultValue={maxTakesPerHour} className={inputClass} />
        </Field>
      </div>
      <div className="flex justify-end">
        <Submit />
      </div>
    </form>
  );
}
