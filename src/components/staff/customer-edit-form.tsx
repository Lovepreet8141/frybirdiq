"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { Field, errorNoteClass, inputClass, submitClass, successNoteClass } from "@/components/inventory/field";
import { Textarea } from "@/components/ui/textarea";
import { type CustomerEditState, updateCustomerAction } from "@/lib/customers/actions";
import { NOTES_MAX } from "@/lib/customers/edit";
import { newEditKey } from "@/lib/customers/edit-key";

function Submit({ offline }: { offline: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending || offline} className={submitClass}>
      {pending ? "Saving…" : "Save customer"}
    </button>
  );
}

/**
 * Correct a customer's name, phone or email and keep notes. Gated by
 * `customers.edit` on the page and again in the action. The idempotency key is
 * minted once per submission attempt (edit-key.ts) so a double-tap or retry replays and a new edit never collides.
 */
export function CustomerEditForm({
  customerId,
  name,
  phone,
  email,
  notes,
}: {
  customerId: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  notes: string | null;
}) {
  const [state, action] = useActionState<CustomerEditState, FormData>(updateCustomerAction, { status: "idle" });
  // One key per submission ATTEMPT (see edit-key.ts): minted when the form is submitted, kept for a double-tap or a
  // retry of the same content (they replay), and dropped whenever the content changes or a result comes back, so the next
  // submit gets a new one. A ref, not state: nothing renders it and it is never read before a submit.
  const attemptKey = useRef<string | null>(null);
  useEffect(() => {
    attemptKey.current = null;
  }, [state]);
  const submit = (formData: FormData) => {
    attemptKey.current ??= newEditKey();
    formData.set("key", attemptKey.current);
    action(formData);
  };
  const [online, setOnline] = useState(true);

  useEffect(() => {
    const sync = () => setOnline(navigator.onLine);
    sync();
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
    };
  }, []);

  return (
    <form action={submit} onChange={() => (attemptKey.current = null)} className="flex flex-col gap-4">
      <input type="hidden" name="customerId" value={customerId} />
      {!online && (
        <p role="status" className={errorNoteClass}>
          You&apos;re offline. Edits can&apos;t be saved until the connection returns.
        </p>
      )}
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
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="customer-name" label="Name">
          <input id="customer-name" name="name" type="text" maxLength={80} defaultValue={name ?? ""} className={inputClass} />
        </Field>
        <Field id="customer-phone" label="Mobile number" hint="10 digits. Rewards and orders are matched on this number.">
          <input id="customer-phone" name="phone" type="tel" inputMode="tel" defaultValue={phone ?? ""} className={inputClass} />
        </Field>
      </div>
      <Field id="customer-email" label="Email">
        <input id="customer-email" name="email" type="email" maxLength={120} defaultValue={email ?? ""} className={inputClass} />
      </Field>
      <Field id="customer-notes" label="Notes" hint={`Staff only, never shown to the customer. Up to ${NOTES_MAX} characters.`}>
        <Textarea id="customer-notes" name="notes" maxLength={NOTES_MAX} rows={4} defaultValue={notes ?? ""} />
      </Field>
      <div className="flex justify-end">
        <Submit offline={!online} />
      </div>
    </form>
  );
}
