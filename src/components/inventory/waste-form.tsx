"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { recordWasteAction } from "@/lib/inventory/waste-actions";
import { type InventoryFormState } from "@/lib/inventory/actions";
import { purchaseUnitsFor, type BaseUnit } from "@/lib/iq/units";
import { WASTE_REASONS, WASTE_REASON_LABEL } from "@/lib/inventory/waste-reasons";
import { Field, errorNoteClass, inputClass, selectClass, submitClass, successNoteClass } from "./field";

export interface WasteIngredientOption {
  readonly id: string;
  readonly name: string;
  readonly baseUnit: BaseUnit;
}

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={submitClass}>
      {pending ? "Recording…" : "Record waste"}
    </button>
  );
}

function Result({ state }: { state: InventoryFormState }) {
  if (state.status === "error") {
    return (
      <p role="alert" className={errorNoteClass}>
        {state.message}
      </p>
    );
  }
  if (state.status === "success") {
    return (
      <p role="status" className={successNoteClass}>
        {state.message}
      </p>
    );
  }
  return null;
}

/** Same shape as `stock-forms.tsx`'s local `UnitSelect` — defaults to the largest unit the ingredient is measured in. Re-keyed by ingredient so the default resets when the ingredient changes. */
function UnitSelect({ id, name, baseUnit }: { id: string; name: string; baseUnit: BaseUnit }) {
  const units = purchaseUnitsFor(baseUnit);
  return (
    <select id={id} name={name} defaultValue={units[units.length - 1]?.unit ?? baseUnit} className={selectClass}>
      {units.map((conversion) => (
        <option key={conversion.unit} value={conversion.unit}>
          {conversion.label}
        </option>
      ))}
    </select>
  );
}

/**
 * Standalone waste-recording form, not nested inside the ingredient detail
 * page's stock panel. Roadmap 3.3: KITCHEN holds `inventory.waste` but not
 * `inventory.view` (docs/INVENTORY-ARCHITECTURE.md §3), so this form cannot
 * live behind the ingredient page's `inventory.view` gate — it carries its
 * own minimal, cost-free ingredient picker instead of reusing the costed
 * admin ingredient list.
 */
export function WasteForm({ ingredients }: { ingredients: readonly WasteIngredientOption[] }) {
  const [state, action] = useActionState<InventoryFormState, FormData>(recordWasteAction, { status: "idle" });
  const [ingredientId, setIngredientId] = useState(ingredients[0]?.id ?? "");
  const selected = ingredients.find((row) => row.id === ingredientId) ?? ingredients[0];

  return (
    <form action={action} className="flex flex-col gap-4">
      <Result state={state} />

      <Field id="waste-ingredient" label="Ingredient">
        <select id="waste-ingredient" name="ingredientId" value={ingredientId} onChange={(event) => setIngredientId(event.target.value)} className={selectClass}>
          {ingredients.map((ingredient) => (
            <option key={ingredient.id} value={ingredient.id}>
              {ingredient.name}
            </option>
          ))}
        </select>
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="waste-qty" label="Quantity">
          <input id="waste-qty" name="quantity" inputMode="decimal" required placeholder="0.6" className={inputClass} />
        </Field>
        <Field id="waste-unit" label="Unit">
          <UnitSelect key={ingredientId} id="waste-unit" name="unit" baseUnit={selected?.baseUnit ?? "G"} />
        </Field>
      </div>

      <Field id="waste-reason" label="Reason">
        <select id="waste-reason" name="reason" defaultValue="PREPARATION" className={selectClass}>
          {WASTE_REASONS.map((reason) => (
            <option key={reason} value={reason}>
              {WASTE_REASON_LABEL[reason]}
            </option>
          ))}
        </select>
      </Field>

      <Field id="waste-notes" label="Notes" hint="Optional — what happened.">
        <input id="waste-notes" name="notes" maxLength={300} className={inputClass} />
      </Field>

      <div className="flex justify-end">
        <Submit />
      </div>
    </form>
  );
}
