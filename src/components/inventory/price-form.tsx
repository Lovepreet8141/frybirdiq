"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { type InventoryFormState, recordPriceAction } from "@/lib/inventory/actions";
import { purchaseUnitsFor } from "@/lib/iq/units";
import { Field, inputClass, selectClass } from "./field";
import type { SupplierOption } from "./ingredient-form";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="inline-flex min-h-[44px] items-center rounded-md bg-primary px-5 text-sm font-semibold text-primary-foreground disabled:opacity-60">
      {pending ? "Recording…" : "Record price"}
    </button>
  );
}

/**
 * "10 kg for ₹2,800." The server converts to base units and works out the
 * usable rate from the ingredient's yield and waste — nothing is computed
 * here. Units offered are only those `units.ts` can convert to this
 * ingredient's base unit; PACK is never offered.
 */
export function PriceForm({
  ingredientId,
  baseUnit,
  suppliers,
  defaultSupplierId,
}: {
  ingredientId: string;
  baseUnit: "G" | "ML" | "PIECE";
  suppliers: readonly SupplierOption[];
  defaultSupplierId: string | null;
}) {
  const [state, action] = useActionState<InventoryFormState, FormData>(recordPriceAction, { status: "idle" });
  const units = purchaseUnitsFor(baseUnit);

  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="ingredientId" value={ingredientId} />
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

      <div className="grid gap-4 sm:grid-cols-[1fr_1fr_1fr]">
        <Field id="price-qty" label="Bought">
          <input id="price-qty" name="purchaseQuantity" inputMode="numeric" required placeholder="10" className={inputClass} />
        </Field>
        <Field id="price-unit" label="Unit">
          <select id="price-unit" name="purchaseUnit" defaultValue={units[units.length - 1]?.unit ?? baseUnit} className={selectClass}>
            {units.map((conversion) => (
              <option key={conversion.unit} value={conversion.unit}>
                {conversion.label}
              </option>
            ))}
          </select>
        </Field>
        <Field id="price-cost" label="For ₹">
          <input id="price-cost" name="purchaseCost" inputMode="decimal" required placeholder="2800" className={inputClass} />
        </Field>
      </div>

      <Field id="price-supplier" label="From">
        <select id="price-supplier" name="supplierId" defaultValue={defaultSupplierId ?? ""} className={selectClass}>
          <option value="">Not recorded</option>
          {suppliers.map((supplier) => (
            <option key={supplier.id} value={supplier.id}>
              {supplier.name}
            </option>
          ))}
        </select>
      </Field>

      <div className="flex justify-end">
        <Submit />
      </div>
    </form>
  );
}
