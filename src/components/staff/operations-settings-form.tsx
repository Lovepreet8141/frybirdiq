"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { type OperationsSettingsState, updateOperationsSettingsAction } from "@/lib/settings/actions";
import { Field, inputClass } from "@/components/inventory/field";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="inline-flex min-h-[44px] items-center rounded-md bg-primary px-5 text-sm font-semibold text-primary-foreground disabled:opacity-60">
      {pending ? "Saving…" : "Save operations settings"}
    </button>
  );
}

/** Kitchen capacity and the opening date — the two facts the Overview's "Right now" and comparison picker read. */
export function OperationsSettingsForm({ kitchenCapacity, openedOn }: { kitchenCapacity: number; openedOn: string | null }) {
  const [state, action] = useActionState<OperationsSettingsState, FormData>(updateOperationsSettingsAction, { status: "idle" });

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
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="ops-capacity" label="Kitchen capacity" hint="Open tickets the kitchen can carry at once. Kitchen load on the Overview is measured against this.">
          <input id="ops-capacity" name="kitchenCapacity" type="number" inputMode="numeric" min={1} max={200} required defaultValue={kitchenCapacity} className={inputClass} />
        </Field>
        <Field id="ops-opened" label="Opening date" hint="Decides which comparisons the Overview offers. Leave blank to use the first order's date.">
          <input id="ops-opened" name="openedOn" type="date" defaultValue={openedOn ?? ""} className={inputClass} />
        </Field>
      </div>
      <div className="flex justify-end">
        <Submit />
      </div>
    </form>
  );
}
