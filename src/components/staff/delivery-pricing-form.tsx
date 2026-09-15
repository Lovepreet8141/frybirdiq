"use client";

import { useMemo, useState, useTransition } from "react";
import { type DeliveryPricingActionInput, updateDeliveryPricingAction } from "@/lib/settings/actions";
import { Field, errorNoteClass, inputClass, submitClass, successNoteClass } from "@/components/inventory/field";

export interface DeliveryBandFormValue {
  readonly upToKm: string;
  readonly flatFee: string;
  readonly perKmFee: string;
}

/**
 * The "Delivery Pricing" section: the free-delivery rule and the distance
 * bands, saved together behind one "Save changes" button. Roadmap-adjacent
 * (not numbered — an approved settings extension of the existing delivery
 * quote engine, `src/lib/delivery`).
 *
 * All three free-delivery fields stay editable regardless of the toggle —
 * turning free delivery off is not supposed to lose the ₹ and km already
 * configured, only re-enabling it should bring them straight back.
 *
 * The number of bands is fixed to whatever currently exists; this edits
 * their distances and fees, it does not add or remove tiers.
 */
export function DeliveryPricingForm({
  freeEnabled: initialFreeEnabled,
  freeAboveOrderValueRupees,
  freeMaxKm: initialFreeMaxKm,
  bands: initialBands,
}: {
  readonly freeEnabled: boolean;
  /** Null when never configured. */
  readonly freeAboveOrderValueRupees: number | null;
  /** Null when no distance restriction is set. */
  readonly freeMaxKm: number | null;
  readonly bands: readonly DeliveryBandFormValue[];
}) {
  const [freeEnabled, setFreeEnabled] = useState(initialFreeEnabled);
  const [freeAboveOrderValue, setFreeAboveOrderValue] = useState(freeAboveOrderValueRupees === null ? "" : String(freeAboveOrderValueRupees));
  const [freeMaxKm, setFreeMaxKm] = useState(initialFreeMaxKm === null ? "" : String(initialFreeMaxKm));
  const [bands, setBands] = useState<readonly DeliveryBandFormValue[]>(initialBands);
  const [pending, startSaving] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  function updateBand(index: number, patch: Partial<DeliveryBandFormValue>) {
    setBands((current) => current.map((band, i) => (i === index ? { ...band, ...patch } : band)));
  }

  /**
   * The plain-English rule, read straight from what's on screen right now —
   * the same explanation an operator sees before saving as after, so there
   * is never a moment where the numbers and the sentence describing them
   * disagree.
   */
  const explanation = useMemo(() => {
    if (!freeEnabled) return "Free delivery is off. Every delivery uses the distance pricing below.";
    if (!freeAboveOrderValue) return "Set a minimum order value to turn free delivery on.";
    const distance = freeMaxKm ? `within ${freeMaxKm} km` : "at any distance we deliver to";
    return `Free delivery ${distance} on orders of ₹${freeAboveOrderValue} or more. Below that, the normal delivery fee applies.`;
  }, [freeEnabled, freeAboveOrderValue, freeMaxKm]);

  function handleSave() {
    setError(null);
    setSuccess(false);

    const input: DeliveryPricingActionInput = {
      freeEnabled,
      freeAboveOrderValue,
      freeMaxKm,
      bands,
    };

    startSaving(async () => {
      const result = await updateDeliveryPricingAction(input);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setSuccess(true);
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {error && (
        <div role="alert" className={errorNoteClass}>
          {error}
        </div>
      )}
      {success && (
        <p role="status" className={successNoteClass}>
          Saved. Checkout reads this from the next load.
        </p>
      )}

      <label className="flex items-center gap-2.5 text-sm font-medium">
        <input
          type="checkbox"
          checked={freeEnabled}
          onChange={(event) => setFreeEnabled(event.target.checked)}
          className="size-4 rounded border-border accent-primary"
        />
        Free delivery
      </label>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="delivery-free-min" label="Minimum order for free delivery (₹)" hint="Below this, the normal delivery fee applies.">
          <input
            id="delivery-free-min"
            type="number"
            inputMode="decimal"
            min={0}
            step={1}
            placeholder="300"
            value={freeAboveOrderValue}
            onChange={(event) => setFreeAboveOrderValue(event.target.value)}
            className={inputClass}
          />
        </Field>
        <Field id="delivery-free-km" label="Free delivery distance (km)" hint="Leave blank for no distance limit — the order value alone decides.">
          <input
            id="delivery-free-km"
            type="number"
            inputMode="decimal"
            min={0}
            step={0.1}
            placeholder="3.0"
            value={freeMaxKm}
            onChange={(event) => setFreeMaxKm(event.target.value)}
            className={inputClass}
          />
        </Field>
      </div>

      <p className="rounded-md border border-border bg-surface-muted px-4 py-3 text-[13px] leading-[1.5]">{explanation}</p>

      <div className="flex flex-col gap-2 border-t border-border pt-4">
        <span className="text-[13px] font-semibold">Distance pricing</span>
        <p className="text-[12.5px] text-muted-foreground">Beyond the free-delivery distance (or always, if free delivery is off), this is what delivery costs.</p>
        <div className="overflow-hidden rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-surface-muted text-left text-[12px] font-semibold text-muted-foreground">
                <th className="px-3 py-2 font-semibold">Up to (km)</th>
                <th className="px-3 py-2 font-semibold">Flat fee (₹)</th>
                <th className="px-3 py-2 font-semibold">+ Per km beyond (₹)</th>
              </tr>
            </thead>
            <tbody>
              {bands.map((band, index) => (
                <tr key={index} className="border-b border-border last:border-0">
                  <td className="p-2">
                    <input
                      aria-label={`Band ${index + 1} — up to, kilometres`}
                      type="number"
                      inputMode="decimal"
                      min={0}
                      step={0.1}
                      value={band.upToKm}
                      onChange={(event) => updateBand(index, { upToKm: event.target.value })}
                      className={inputClass}
                    />
                  </td>
                  <td className="p-2">
                    <input
                      aria-label={`Band ${index + 1} — flat fee, rupees`}
                      type="number"
                      inputMode="decimal"
                      min={0}
                      step={1}
                      value={band.flatFee}
                      onChange={(event) => updateBand(index, { flatFee: event.target.value })}
                      className={inputClass}
                    />
                  </td>
                  <td className="p-2">
                    <input
                      aria-label={`Band ${index + 1} — per km fee beyond, rupees`}
                      type="number"
                      inputMode="decimal"
                      min={0}
                      step={1}
                      value={band.perKmFee}
                      onChange={(event) => updateBand(index, { perKmFee: event.target.value })}
                      className={inputClass}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex justify-end">
        <button type="button" disabled={pending} onClick={handleSave} className={submitClass}>
          {pending ? "Saving…" : "Save changes"}
        </button>
      </div>
    </div>
  );
}
