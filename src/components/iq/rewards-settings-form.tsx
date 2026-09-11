"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { type RewardsSettingsState, updateStampConfigAction } from "@/lib/loyalty/actions";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex min-h-[44px] items-center rounded-md bg-primary px-5 text-sm font-semibold text-primary-foreground disabled:opacity-60"
    >
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
    <form action={action} className="mt-8 flex max-w-lg flex-col gap-5">
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

      <label className="flex min-h-[44px] cursor-pointer items-center gap-3 rounded-md border border-border bg-surface px-4">
        <input type="checkbox" name="enabled" defaultChecked={enabled} className="size-4 accent-primary" />
        <span className="text-sm font-semibold">FRYBIRD REWARDS is live</span>
      </label>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="stampsRequired" className="text-sm font-semibold">
          Stamps to unlock a free item
        </label>
        <input
          id="stampsRequired"
          name="stampsRequired"
          type="number"
          min={1}
          max={50}
          required
          defaultValue={stampsRequired}
          className="tabular min-h-[44px] w-full rounded-md border border-border bg-surface px-3 py-2.5"
        />
        <p className="text-xs text-muted-foreground">Currently 7 — collect this many, the next free item is on the house.</p>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="minOrderValue" className="text-sm font-semibold">
          Qualifying spend
        </label>
        <div className="flex items-center gap-2">
          <span aria-hidden="true" className="text-lg text-muted-foreground">₹</span>
          <input
            id="minOrderValue"
            name="minOrderValue"
            required
            inputMode="decimal"
            defaultValue={toRupeeString(minOrderValue)}
            className="tabular min-h-[44px] w-full rounded-md border border-border bg-surface px-3 py-2.5"
          />
        </div>
        <p className="text-xs text-muted-foreground">An order has to spend more than this — exactly this much does not qualify.</p>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="maxRewardValue" className="text-sm font-semibold">
          Free item price cap
        </label>
        <div className="flex items-center gap-2">
          <span aria-hidden="true" className="text-lg text-muted-foreground">₹</span>
          <input
            id="maxRewardValue"
            name="maxRewardValue"
            required
            inputMode="decimal"
            defaultValue={toRupeeString(maxRewardValue)}
            className="tabular min-h-[44px] w-full rounded-md border border-border bg-surface px-3 py-2.5"
          />
        </div>
        <p className="text-xs text-muted-foreground">Only items listed at this price or under can be the free redemption.</p>
      </div>

      <div className="flex items-center gap-3 pt-1">
        <Submit />
      </div>
    </form>
  );
}
