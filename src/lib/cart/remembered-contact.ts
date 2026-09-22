import "server-only";

/**
 * Who ordered last, on this device.
 *
 * For guests, who have no account to read from. Same reasoning as the
 * remembered address: a cookie is the one store that cannot leak between
 * people, because it never leaves the browser that wrote it. Looking a name up
 * by a typed phone number would hand one customer's details to anyone who
 * knows their number.
 *
 * httpOnly, so a script on the page cannot read it either. Validated on read
 * and re-validated on submit. SIGNED with `COOKIE_SECRET` (contact-cookie.ts):
 * before, a tampered cookie could carry someone else's phone number and
 * `/order/[id]` would believe it.
 *
 * `COOKIE_SECRET` is required, with no unsigned fallback (`cookie-secret-dependency`,
 * post-launch card): if it is unset or malformed, every cookie read here is
 * treated as absent and nothing is remembered — a customer types their details
 * again, which is safe — rather than trusting a bare phone number, which is
 * not. Each read/write while the secret is missing logs an alert so the
 * misconfiguration is visible in the journal, not silent.
 */

import { cookies } from "next/headers";
import { z } from "zod";
import { cookieSecret } from "@/lib/env";
import { MAX_REMEMBERED_ORDERS, decodeContactCookie, encodeContactCookie, withOrder } from "./contact-cookie";

const COOKIE = "frybird_contact";

const contactSchema = z.object({
  name: z.string().min(1).max(80),
  phone: z.string().regex(/^[6-9]\d{9}$/),
  email: z.string().email().max(160),
});
const payloadSchema = contactSchema.extend({ orders: z.array(z.string().uuid()).max(MAX_REMEMBERED_ORDERS).optional() });

export type RememberedContact = z.infer<typeof contactSchema> & {
  /** The orders this browser placed, newest first. A signed cookie proves this list, never a bare phone number. */
  readonly orderIds: readonly string[];
};

/** Logs once per call site per request — loud on purpose: this is a permanent misconfiguration, not a transient blip. */
function alertMissingSecret(secret: Exclude<ReturnType<typeof cookieSecret>, { kind: "ok" }>, where: string): void {
  console.error(
    secret.kind === "none"
      ? `remembered-contact: COOKIE_SECRET is unset — ${where}, treating the frybird_contact cookie as absent`
      : `remembered-contact: COOKIE_SECRET is invalid — ${where}, treating the frybird_contact cookie as absent`,
  );
}

async function readPayload(): Promise<{ contact: z.infer<typeof payloadSchema> } | null> {
  const raw = (await cookies()).get(COOKIE)?.value;
  if (!raw) return null;
  const secret = cookieSecret();
  if (secret.kind !== "ok") {
    alertMissingSecret(secret, "cannot verify a remembered-contact cookie");
    return null; // no unsigned fallback: an unverifiable cookie is exactly as good as no cookie
  }
  const parsed = payloadSchema.safeParse(decodeContactCookie(raw, secret.secret));
  return parsed.success ? { contact: parsed.data } : null;
}

export async function readRememberedContact(): Promise<RememberedContact | null> {
  const read = await readPayload();
  if (!read) return null;
  const { orders, ...contact } = read.contact;
  return { ...contact, orderIds: orders ?? [] };
}

/**
 * Remembers who ordered (to pre-fill the next checkout) and which order this browser just placed. The signed cookie
 * proves the orders it was issued for; ownership of an order is decided by that list, never by a phone number someone
 * typed (see viewer-owns-order.ts). Writes nothing at all when there is no secret to sign with.
 */
export async function rememberContact(contact: unknown, orderId?: string): Promise<void> {
  const parsed = contactSchema.safeParse(contact);
  if (!parsed.success) return;
  const secret = cookieSecret();
  if (secret.kind !== "ok") {
    alertMissingSecret(secret, "not writing a remembered-contact cookie");
    return;
  }

  const previous = (await readPayload())?.contact.orders ?? [];
  const payload = { ...parsed.data, orders: withOrder(previous, orderId ?? "").filter(Boolean) };
  (await cookies()).set(COOKIE, encodeContactCookie(payload, secret.secret), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 180,
  });
}
