/**
 * Editing a customer — the pure part (roadmap 7.1).
 *
 * What staff may change: name, phone, email and notes. Marketing consent is
 * deliberately absent — it is recorded from the customer's own act (§83) and
 * a staff edit must never flip it. The same parse runs in the server action;
 * nothing the form sent is trusted past this function.
 */

import { z } from "zod";
import { parseMobile } from "@/lib/pos/rewards-enrolment";

export const NOTES_MAX = 1000;

export interface CustomerEdit {
  readonly name: string | null;
  readonly phone: string | null;
  readonly email: string | null;
  readonly notes: string | null;
  /** Idempotency key minted when the form rendered: a double-tap or a retry replays. */
  readonly key: string;
}

const blankToNull = (value: string) => (value.trim() === "" ? null : value.trim());

const schema = z.object({
  name: z.string().trim().max(80, "A name is at most 80 characters.").transform(blankToNull),
  phone: z.string().transform((value, ctx) => {
    if (value.trim() === "") return null;
    const parsed = parseMobile(value);
    if (parsed.ok) return parsed.phone;
    ctx.addIssue({ code: "custom", message: parsed.error });
    return z.NEVER;
  }),
  email: z
    .string()
    .trim()
    .max(120, "An email is at most 120 characters.")
    .refine((value) => value === "" || z.email().safeParse(value).success, "That doesn't look like an email address.")
    .transform(blankToNull),
  notes: z.string().max(NOTES_MAX, `Notes are at most ${NOTES_MAX} characters.`).transform(blankToNull),
  key: z.string().min(8, "Reload the page and try again.").max(120, "Reload the page and try again."),
});

export type CustomerEditResult = { readonly ok: true; readonly value: CustomerEdit } | { readonly ok: false; readonly error: string };

export function parseCustomerEdit(input: Record<string, string>): CustomerEditResult {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the form." };
  return { ok: true, value: parsed.data };
}

/** For the audit row: enough to tell which number changed, never the number. */
export function maskPhone(phone: string | null): string | null {
  if (!phone) return null;
  return `${"*".repeat(Math.max(0, phone.length - 4))}${phone.slice(-4)}`;
}
