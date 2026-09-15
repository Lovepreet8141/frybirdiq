"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { type SettingsFormState, updateBusinessProfileAction } from "@/lib/settings/actions";
import { Field, inputClass } from "@/components/inventory/field";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="inline-flex min-h-[44px] items-center rounded-md bg-primary px-5 text-sm font-semibold text-primary-foreground disabled:opacity-60">
      {pending ? "Saving…" : "Save business profile"}
    </button>
  );
}

/**
 * Trading name and opening hours. Roadmap 5.5.
 *
 * The one form on the Restaurant page that changes what the public website
 * shows — the homepage's "Kitchen hours" stat and the JSON-LD an hour is
 * how search engines learn it. Legal name, GSTIN, menu prices and currency
 * stay read-only next to this: `settings.ts`'s `updateBusinessProfile`
 * physically cannot touch them.
 */
export function BusinessProfileForm({ name, openingTime, closingTime }: { name: string; openingTime: string; closingTime: string }) {
  const [state, action] = useActionState<SettingsFormState, FormData>(updateBusinessProfileAction, { status: "idle" });

  return (
    <form action={action} className="flex flex-col gap-4 rounded-lg border border-border p-4">
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
      <Field id="profile-name" label="Trading name" hint="Shown on the website, the receipt header and the staff shell.">
        <input id="profile-name" name="name" type="text" required maxLength={80} defaultValue={name} className={inputClass} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="profile-opens" label="Opens" hint="24-hour clock. The website reads this on its next load.">
          <input id="profile-opens" name="openingTime" type="time" required defaultValue={openingTime} className={inputClass} />
        </Field>
        <Field id="profile-closes" label="Closes">
          <input id="profile-closes" name="closingTime" type="time" required defaultValue={closingTime} className={inputClass} />
        </Field>
      </div>
      <div className="flex justify-end">
        <Submit />
      </div>
    </form>
  );
}
