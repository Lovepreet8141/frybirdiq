"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Field, errorNoteClass, inputClass, submitClass, successNoteClass } from "@/components/inventory/field";
import { type RewardsSettingsState, updateStampConfigAction } from "@/lib/loyalty/actions";
import { cn } from "@/lib/utils";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={submitClass}>
      {pending ? "Saving…" : "Save"}
    </button>
  );
}

/** Rupees only, no paise — this program's thresholds are round numbers in practice. */
function toRupeeString(paise: bigint): string {
  return (Number(paise) / 100).toString();
}

export function RewardsSettingsForm({
  enabled,
  stampsRequired,
  minOrderValue,
  maxRewardValue,
}: {
  enabled: boolean;
  stampsRequired: number;
  minOrderValue: bigint;
  maxRewardValue: bigint;
}) {
  const [state, action] = useActionState<RewardsSettingsState, FormData>(updateStampConfigAction, { status: "idle" });

  return (
    <form action={action} className="flex flex-col gap-4">
      {state.status === "error" && (
        <p role="alert" className={errorNoteClass}>
          {state.message}
        </p>
      )}
      {state.status === "success" && (
        <p role="status" className={successNoteClass}>
          {state.message}
        </p>
      )}

      <label className="flex h-10 cursor-pointer items-center gap-3 rounded-md border border-border bg-surface px-4">
        <input type="checkbox" name="enabled" defaultChecked={enabled} className="size-4 accent-primary" />
        <span className="text-sm font-semibold">FRYBIRD REWARDS is live</span>
      </label>

      <Field id="stampsRequired" label="Stamps to unlock a free item" hint="Currently 7 — collect this many, the next free item is on the house.">
        <input
          id="stampsRequired"
          name="stampsRequired"
          type="number"
          min={1}
          max={50}
          required
          defaultValue={stampsRequired}
          className={cn(inputClass, "tabular")}
        />
      </Field>

      <Field id="minOrderValue" label="Qualifying spend" hint="An order has to spend more than this — exactly this much does not qualify.">
        <div className="flex items-center gap-2">
          <span aria-hidden="true" className="text-base text-muted-foreground">₹</span>
          <input
            id="minOrderValue"
            name="minOrderValue"
            required
            inputMode="decimal"
            defaultValue={toRupeeString(minOrderValue)}
            className={cn(inputClass, "tabular")}
          />
        </div>
      </Field>

      <Field id="maxRewardValue" label="Free item price cap" hint="Only items listed at this price or under can be the free redemption.">
        <div className="flex items-center gap-2">
          <span aria-hidden="true" className="text-base text-muted-foreground">₹</span>
          <input
            id="maxRewardValue"
            name="maxRewardValue"
            required
            inputMode="decimal"
            defaultValue={toRupeeString(maxRewardValue)}
            className={cn(inputClass, "tabular")}
          />
        </div>
      </Field>

      <div className="flex items-center gap-3 pt-1">
        <Submit />
      </div>
    </form>
  );
}
