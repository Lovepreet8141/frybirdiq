"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { type InventoryFormState, saveSupplierAction } from "@/lib/inventory/actions";
import { Field, errorNoteClass, inputClass, submitClass, successNoteClass } from "./field";

export interface SupplierFormValues {
  readonly id?: string;
  readonly name: string;
  readonly phone: string | null;
  readonly email: string | null;
  readonly gstin: string | null;
  readonly address: string | null;
  readonly isActive: boolean;
}

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={submitClass}>
      {pending ? "Saving…" : label}
    </button>
  );
}

export function SupplierForm({ initial }: { initial?: SupplierFormValues }) {
  const [state, action] = useActionState<InventoryFormState, FormData>(saveSupplierAction, { status: "idle" });

  return (
    <form action={action} className="flex flex-col gap-4">
      {initial?.id && <input type="hidden" name="id" value={initial.id} />}
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

      <Field id="supplier-name" label="Name">
        <input id="supplier-name" name="name" required maxLength={120} defaultValue={initial?.name ?? ""} className={inputClass} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="supplier-phone" label="Phone">
          <input id="supplier-phone" name="phone" inputMode="tel" defaultValue={initial?.phone ?? ""} className={inputClass} />
        </Field>
        <Field id="supplier-email" label="Email">
          <input id="supplier-email" name="email" type="email" defaultValue={initial?.email ?? ""} className={inputClass} />
        </Field>
      </div>
      <Field id="supplier-gstin" label="GSTIN" hint="15 characters. Needed to claim input credit on what you buy from them.">
        <input id="supplier-gstin" name="gstin" maxLength={15} defaultValue={initial?.gstin ?? ""} className={`${inputClass} font-mono uppercase`} />
      </Field>
      <Field id="supplier-address" label="Address">
        <input id="supplier-address" name="address" maxLength={300} defaultValue={initial?.address ?? ""} className={inputClass} />
      </Field>
      <label className="flex min-h-[40px] items-center gap-2 text-sm">
        <input type="checkbox" name="isActive" defaultChecked={initial?.isActive ?? true} className="size-4 accent-primary" />
        Active — appears when recording prices and purchases
      </label>

      <div className="flex justify-end">
        <Submit label={initial?.id ? "Save supplier" : "Add supplier"} />
      </div>
    </form>
  );
}
