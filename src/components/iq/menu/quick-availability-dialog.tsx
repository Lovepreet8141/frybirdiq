"use client";

import { useState, useTransition } from "react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { ReloadAppButton } from "@/components/reload-app-button";
import { quickSetAvailabilityAction } from "@/lib/menu-admin/actions";
import { REACTIVATION_PRESETS, UNAVAILABLE_REASON_PRESETS, type ReactivationPreset } from "@/lib/menu-admin/constants";
import { STALE_DEPLOYMENT_MESSAGE, recoverFromStaleDeployment } from "@/lib/errors/stale-deployment";

const REACTIVATION_LABELS: Record<ReactivationPreset, string> = {
  "2h": "Back in 2 hours",
  "4h": "Back in 4 hours",
  tomorrow: "Sold out for today, back tomorrow",
  custom: "Back at a specific time",
  indefinite: "Unavailable until turned back on",
};

/**
 * The row/card's "Mark unavailable" action — a reason and a reactivation
 * choice, not a raw status/timestamp form. `quickSetAvailabilityAction`
 * turns these presets into the same status + timestamp the full
 * availability form would produce, so both paths write through one rule.
 */
export function QuickAvailabilityDialog({ productId, productName, trigger }: { productId: string; productName: string; trigger: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<(typeof UNAVAILABLE_REASON_PRESETS)[number]>("Sold out");
  const [customReason, setCustomReason] = useState("");
  const [reactivation, setReactivation] = useState<ReactivationPreset>("indefinite");
  const [customUntil, setCustomUntil] = useState("");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function submit() {
    startTransition(async () => {
      const result = await recoverFromStaleDeployment(() => quickSetAvailabilityAction({ productId, reason, customReason, reactivation, customUntil }));
      if (!result.ok) {
        setError(result.error ?? "Could not update availability.");
        return;
      }
      setError(null);
      setOpen(false);
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<span>{trigger}</span>} />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Mark &quot;{productName}&quot; unavailable</DialogTitle>
        </DialogHeader>

        {error && (
          <div role="alert" className="flex flex-col items-start gap-2 text-sm text-[var(--destructive)]">
            {error}
            {error === STALE_DEPLOYMENT_MESSAGE && <ReloadAppButton />}
          </div>
        )}

        <fieldset className="flex flex-col gap-1.5">
          <legend className="mb-1 text-sm font-semibold">Reason</legend>
          {UNAVAILABLE_REASON_PRESETS.map((option) => (
            <label key={option} className="flex min-h-[36px] cursor-pointer items-center gap-2 text-sm">
              <input type="radio" name="reason" checked={reason === option} onChange={() => setReason(option)} className="size-4 accent-primary" />
              {option}
            </label>
          ))}
          {reason === "Other" && (
            <input
              value={customReason}
              onChange={(e) => setCustomReason(e.target.value)}
              placeholder="Say what's going on"
              className="mt-1 min-h-[36px] rounded-md border border-border bg-surface px-3 text-sm"
            />
          )}
        </fieldset>

        <fieldset className="flex flex-col gap-1.5">
          <legend className="mb-1 text-sm font-semibold">Back when?</legend>
          {REACTIVATION_PRESETS.map((option) => (
            <label key={option} className="flex min-h-[36px] cursor-pointer items-center gap-2 text-sm">
              <input type="radio" name="reactivation" checked={reactivation === option} onChange={() => setReactivation(option)} className="size-4 accent-primary" />
              {REACTIVATION_LABELS[option]}
            </label>
          ))}
          {reactivation === "custom" && (
            <input
              type="datetime-local"
              value={customUntil}
              onChange={(e) => setCustomUntil(e.target.value)}
              className="mt-1 min-h-[36px] rounded-md border border-border bg-surface px-3 text-sm"
            />
          )}
        </fieldset>

        <DialogFooter>
          <button
            type="button"
            onClick={submit}
            disabled={isPending}
            className="inline-flex min-h-[40px] items-center rounded-md bg-[var(--destructive)] px-4 text-sm font-semibold text-white disabled:opacity-60"
          >
            {isPending ? "Saving…" : "Mark unavailable"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
