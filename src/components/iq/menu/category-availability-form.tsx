"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { AVAILABILITY_STATUSES, type AvailabilityStatus } from "@/domain/menu-availability";
import { type ActionResult, deleteCategoryAvailabilityRuleAction, setCategoryAvailabilityRuleAction } from "@/lib/menu-admin/actions";
import { ActionButton } from "./action-button";

const STATUS_LABELS: Record<AvailabilityStatus, string> = {
  AVAILABLE: "Visible",
  TEMPORARILY_UNAVAILABLE: "Hidden",
  SOLD_OUT_TODAY: "Hidden for today",
  SCHEDULED_UNAVAILABLE: "Hidden until a set time",
};

const CHANNEL_LABELS: Record<string, string> = {
  "": "Every channel",
  DINE_IN: "Dine-in",
  TAKEAWAY: "Takeaway",
  ONLINE: "Website",
  KIOSK: "Kiosk (visibility only — not live yet)",
  SWIGGY: "Swiggy (visibility only — not connected)",
  ZOMATO: "Zomato (visibility only — not connected)",
};

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="inline-flex min-h-[40px] items-center rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-60">
      {pending ? "Saving…" : "Add rule"}
    </button>
  );
}

const IDLE: ActionResult = { ok: true };

/**
 * Whole-category visibility per channel — "hide Combos from Kiosk" without
 * touching every product in it. Uses the same status vocabulary as product
 * availability (AVAILABLE/TEMPORARILY_UNAVAILABLE/SCHEDULED_UNAVAILABLE are
 * the ones that make sense here — the form doesn't offer SOLD_OUT_TODAY,
 * since "the category ran out" isn't a real concept).
 */
export function CategoryAvailabilityForm({
  categoryId,
  rules,
}: {
  categoryId: string;
  rules: readonly { id: string; channel: string | null; status: AvailabilityStatus; unavailableUntil: Date | null; reason: string | null }[];
}) {
  const action = setCategoryAvailabilityRuleAction.bind(null, categoryId);
  const [state, formAction] = useActionState<ActionResult, FormData>(action, IDLE);

  return (
    <div className="flex flex-col gap-4">
      {rules.length === 0 ? (
        <p className="text-sm text-muted-foreground">Visible everywhere — no exceptions set.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {rules.map((rule) => (
            <li key={rule.id} className="flex items-center justify-between gap-3 rounded-md border border-border bg-surface-muted px-3 py-2 text-sm">
              <span>
                <strong>{CHANNEL_LABELS[rule.channel ?? ""] ?? rule.channel}</strong>: {STATUS_LABELS[rule.status]}
                {rule.reason && ` — ${rule.reason}`}
                {rule.unavailableUntil && ` until ${rule.unavailableUntil.toLocaleString("en-IN")}`}
              </span>
              <ActionButton action={() => deleteCategoryAvailabilityRuleAction(rule.id)} variant="destructive">
                Remove
              </ActionButton>
            </li>
          ))}
        </ul>
      )}

      <form action={formAction} className="flex flex-wrap items-end gap-2 border-t border-border pt-3">
        {!state.ok && state.error && (
          <p role="alert" className="w-full text-sm text-[var(--destructive)]">
            {state.error}
          </p>
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
          Visibility
          <select name="status" className="min-h-[40px] rounded-md border border-border bg-surface px-3 font-normal">
            {AVAILABILITY_STATUSES.filter((s) => s !== "AVAILABLE" && s !== "SOLD_OUT_TODAY").map((status) => (
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
