"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { type InventoryFormState, saveIngredientAction } from "@/lib/inventory/actions";
import { Field, errorNoteClass, inputClass, selectClass, submitClass, successNoteClass } from "./field";

export interface IngredientFormValues {
  readonly id?: string;
  readonly name: string;
  readonly sku: string | null;
  readonly baseUnit: "G" | "ML" | "PIECE";
  readonly yieldBps: number;
  readonly wasteBps: number;
  readonly supplierId: string | null;
  readonly isPackaging: boolean;
  readonly isActive: boolean;
}

export interface SupplierOption {
  readonly id: string;
  readonly name: string;
}

const BASE_UNIT_LABELS = { G: "Grams (g)", ML: "Millilitres (ml)", PIECE: "Pieces" } as const;

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={submitClass}>
      {pending ? "Saving…" : label}
    </button>
  );
}

/**
 * Yield and waste are entered as percentages and stored as basis points by
 * the action. The base unit locks once the ingredient has a price or a
 * recipe line — the server refuses the change; the field just says so.
 */
export function IngredientForm({ initial, suppliers, lockBaseUnit = false }: { initial?: IngredientFormValues; suppliers: readonly SupplierOption[]; lockBaseUnit?: boolean }) {
  const [state, action] = useActionState<InventoryFormState, FormData>(saveIngredientAction, { status: "idle" });

  return (
    <form action={action} className="flex flex-col gap-4">
      {initial?.id && <input type="hidden" name="id" value={initial.id} />}
      {lockBaseUnit && initial && <input type="hidden" name="baseUnit" value={initial.baseUnit} />}
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

      <div className="grid gap-4 sm:grid-cols-[1fr_140px]">
        <Field id="ing-name" label="Name">
          <input id="ing-name" name="name" required maxLength={120} defaultValue={initial?.name ?? ""} className={inputClass} placeholder="Chicken breast" />
        </Field>
        <Field id="ing-sku" label="SKU">
          <input id="ing-sku" name="sku" maxLength={40} defaultValue={initial?.sku ?? ""} className={inputClass} />
        </Field>
      </div>

      <Field
        id="ing-unit"
        label="Measured in"
        hint={lockBaseUnit ? "Locked — a price or recipe already uses this unit. Create a new ingredient to change it." : "What a recipe will measure this in. Purchases in kg or litres convert exactly."}
      >
        <select id="ing-unit" name="baseUnit" defaultValue={initial?.baseUnit ?? "G"} disabled={lockBaseUnit} className={selectClass}>
          {(Object.keys(BASE_UNIT_LABELS) as (keyof typeof BASE_UNIT_LABELS)[]).map((unit) => (
            <option key={unit} value={unit}>
              {BASE_UNIT_LABELS[unit]}
            </option>
          ))}
        </select>
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="ing-yield" label="Yield %" hint="What survives trimming. 1 kg chicken that trims to 800 g is 80.">
          <input id="ing-yield" name="yieldPct" inputMode="decimal" required defaultValue={initial ? (initial.yieldBps / 100).toString() : "100"} className={inputClass} />
        </Field>
        <Field id="ing-waste" label="Waste %" hint="Lost after prep to spoilage and spillage. Usually small.">
          <input id="ing-waste" name="wastePct" inputMode="decimal" required defaultValue={initial ? (initial.wasteBps / 100).toString() : "0"} className={inputClass} />
        </Field>
      </div>

      <Field id="ing-supplier" label="Usual supplier">
        <select id="ing-supplier" name="supplierId" defaultValue={initial?.supplierId ?? ""} className={selectClass}>
          <option value="">No usual supplier</option>
          {suppliers.map((supplier) => (
            <option key={supplier.id} value={supplier.id}>
              {supplier.name}
            </option>
          ))}
        </select>
      </Field>

      <div className="flex flex-col gap-2">
        <label className="flex min-h-[40px] items-center gap-2 text-sm">
          <input type="checkbox" name="isPackaging" defaultChecked={initial?.isPackaging ?? false} className="size-4 accent-primary" />
          Packaging — a box, cup or bag: costed into a product, never eaten
        </label>
        <label className="flex min-h-[40px] items-center gap-2 text-sm">
          <input type="checkbox" name="isActive" defaultChecked={initial?.isActive ?? true} className="size-4 accent-primary" />
          Active
        </label>
      </div>

      <div className="flex justify-end">
        <Submit label={initial?.id ? "Save ingredient" : "Add ingredient"} />
      </div>
    </form>
  );
}
