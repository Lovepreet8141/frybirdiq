"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { AVAILABILITY_STATUSES, type AvailabilityStatus } from "@/domain/menu-availability";
import { type ActionResult, deleteAvailabilityRuleAction, setAvailabilityRuleAction } from "@/lib/menu-admin/actions";
import { ReloadAppButton } from "@/components/reload-app-button";
import { STALE_DEPLOYMENT_MESSAGE, recoverFromStaleDeployment } from "@/lib/errors/stale-deployment";
import { ActionButton } from "./action-button";

const STATUS_LABELS: Record<AvailabilityStatus, string> = {
  AVAILABLE: "Available",
  TEMPORARILY_UNAVAILABLE: "Temporarily unavailable",
  SOLD_OUT_TODAY: "Sold out today",
  SCHEDULED_UNAVAILABLE: "Unavailable until a set time",
};

const CHANNEL_LABELS: Record<string, string> = {
  "": "Every channel",
  DINE_IN: "Dine-in",
  TAKEAWAY: "Takeaway",
  ONLINE: "Website",
  KIOSK: "Kiosk (menu visibility only — not live yet)",
  SWIGGY: "Swiggy (menu visibility only — not connected)",
  ZOMATO: "Zomato (menu visibility only — not connected)",
};

export interface AvailabilityRuleView {
  readonly id: string;
  readonly channel: string | null;
  readonly status: AvailabilityStatus;
  readonly unavailableUntil: Date | null;
  readonly reason: string | null;
}

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex min-h-[40px] items-center rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-60"
    >
      {pending ? "Saving…" : "Add rule"}
    </button>
  );
}

const IDLE: ActionResult = { ok: true };

/**
 * A product's channel-specific availability. "Every channel" is the
 * wildcard row — set it and the product is 86'd everywhere at once. A
 * channel-specific rule only affects that one channel, which is how "sold
 * out for delivery, still fine dine-in" gets expressed.
 *
 * There is one location today, so a location picker would be a control with
 * nothing to choose — every rule here implicitly applies to it.
 */
export function ProductAvailabilityForm({ productId, rules }: { productId: string; rules: readonly AvailabilityRuleView[] }) {
  const boundAction = setAvailabilityRuleAction.bind(null, productId);
  const action = (prev: ActionResult, formData: FormData) => recoverFromStaleDeployment(() => boundAction(prev, formData));
  const [state, formAction] = useActionState<ActionResult, FormData>(action, IDLE);

  return (
    <div className="flex flex-col gap-4">
      {rules.length === 0 ? (
        <p className="text-sm text-muted-foreground">Available everywhere — no exceptions set.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {rules.map((rule) => (
            <li key={rule.id} className="flex items-center justify-between gap-3 rounded-md border border-border bg-surface-muted px-3 py-2 text-sm">
              <span>
                <strong>{CHANNEL_LABELS[rule.channel ?? ""] ?? rule.channel}</strong>: {STATUS_LABELS[rule.status]}
                {rule.reason && ` — ${rule.reason}`}
                {rule.unavailableUntil && ` until ${rule.unavailableUntil.toLocaleString("en-IN")}`}
              </span>
              <ActionButton action={() => deleteAvailabilityRuleAction(rule.id)} variant="destructive">
                Remove
              </ActionButton>
            </li>
          ))}
        </ul>
      )}

      <form action={formAction} className="flex flex-wrap items-end gap-2 border-t border-border pt-3">
        {!state.ok && state.error && (
          <div role="alert" className="flex w-full flex-col items-start gap-1.5 text-sm text-[var(--destructive)]">
            {state.error}
            {state.error === STALE_DEPLOYMENT_MESSAGE && <ReloadAppButton />}
          </div>
        )}
        <label className="flex flex-col gap-1 text-sm font-semibold">
          Channel
          <select name="channel" className="min-h-[40px] rounded-md border border-border bg-surface px-3 font-normal">
            <option value="">Every channel</option>
            <option value="DINE_IN">Dine-in</option>
            <option value="TAKEAWAY">Takeaway</option>
            <option value="ONLINE">Website</option>
            <option value="KIOSK">Kiosk (visibility only)</option>
            <option value="SWIGGY">Swiggy (visibility only)</option>
            <option value="ZOMATO">Zomato (visibility only)</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm font-semibold">
          Status
          <select name="status" className="min-h-[40px] rounded-md border border-border bg-surface px-3 font-normal">
            {AVAILABILITY_STATUSES.filter((s) => s !== "AVAILABLE").map((status) => (
              <option key={status} value={status}>
                {STATUS_LABELS[status]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm font-semibold">
          Back at <span className="font-normal text-muted-foreground">(scheduled only)</span>
          <input type="datetime-local" name="unavailableUntil" className="min-h-[40px] rounded-md border border-border bg-surface px-3 font-normal" />
        </label>
        <label className="flex flex-col gap-1 text-sm font-semibold">
          Reason <span className="font-normal text-muted-foreground">(shown to staff)</span>
          <input name="reason" className="min-h-[40px] rounded-md border border-border bg-surface px-3 font-normal" />
        </label>
        <Submit />
      </form>
    </div>
  );
}
