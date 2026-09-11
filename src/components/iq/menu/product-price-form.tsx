"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { type ActionResult, updateProductPriceAction } from "@/lib/menu-admin/actions";
import { type Paise, toRupeesFloat } from "@/lib/money";
import { ReloadAppButton } from "@/components/reload-app-button";
import { STALE_DEPLOYMENT_MESSAGE, recoverFromStaleDeployment } from "@/lib/errors/stale-deployment";

const IDLE: ActionResult = { ok: true };

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex min-h-[40px] items-center rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-60"
    >
      {pending ? "Saving…" : "Save price"}
    </button>
  );
}

/** `menu.price`-gated at the action layer — this is the one field a MANAGER cannot change. */
export function ProductPriceForm({ id, basePrice, updatedAt }: { id: string; basePrice: Paise; updatedAt: Date }) {
  const boundAction = updateProductPriceAction.bind(null, id);
  const action = (prev: ActionResult, formData: FormData) => recoverFromStaleDeployment(() => boundAction(prev, formData));
  const [state, formAction] = useActionState<ActionResult, FormData>(action, IDLE);
  const justSaved = state !== IDLE && state.ok;
  const isStale = !state.ok && state.error === STALE_DEPLOYMENT_MESSAGE;
  const isConflict = !state.ok && !isStale && state.error?.includes("changed by someone else") === true;

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="expectedUpdatedAt" value={updatedAt.toISOString()} />
      {!state.ok && state.error && (
        <div role="alert" className="flex flex-col items-start gap-1.5 text-sm text-[var(--destructive)]">
          <p>
            {state.error}
            {isConflict && (
              <>
                {" "}
                <a href="" className="underline">
                  Reload the page
                </a>
                .
              </>
            )}
          </p>
          {isStale && <ReloadAppButton />}
        </div>
      )}
      {justSaved && (
        <p role="status" className="text-sm text-[var(--success)]">
          Saved.
        </p>
      )}
      <label className="flex flex-col gap-1 text-sm font-semibold">
        Listed price <span className="font-normal text-muted-foreground">(GST-inclusive — see FRYBIRD IQ&apos;s pricing basis)</span>
        <div className="flex items-center gap-2">
          <span aria-hidden="true" className="text-lg text-muted-foreground">₹</span>
          <input
            name="basePrice"
            required
            inputMode="decimal"
            defaultValue={toRupeesFloat(basePrice)}
            className="tabular min-h-[40px] w-40 rounded-md border border-border bg-surface px-3 font-normal"
          />
        </div>
      </label>
      <div>
        <Submit />
      </div>
    </form>
  );
}
