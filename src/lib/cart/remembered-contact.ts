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
 * and re-validated on submit. With `COOKIE_SECRET` set it is also SIGNED
 * (contact-cookie.ts): before, a tampered cookie could carry someone else's
 * phone number and `/order/[id]` would believe it.
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
  /** The orders this browser placed, newest first. Empty for an unsigned cookie. */
  readonly orderIds: readonly string[];
  /** True only for a cookie verified against COOKIE_SECRET. A trusted cookie proves orders, not a phone number. */
  readonly trusted: boolean;
};

async function readPayload(): Promise<{ contact: z.infer<typeof payloadSchema>; trusted: boolean } | null> {
  const raw = (await cookies()).get(COOKIE)?.value;
  if (!raw) return null;
  const secret = cookieSecret();
  if (secret.kind === "invalid") return null; // a malformed secret fails closed: no remembered contact, never a broken page
  const parsed = payloadSchema.safeParse(decodeContactCookie(raw, secret.kind === "ok" ? secret.secret : undefined));
  return parsed.success ? { contact: parsed.data, trusted: secret.kind === "ok" } : null;
}

export async function readRememberedContact(): Promise<RememberedContact | null> {
  const read = await readPayload();
  if (!read) return null;
  const { orders, ...contact } = read.contact;
  return { ...contact, orderIds: read.trusted ? (orders ?? []) : [], trusted: read.trusted };
}

/**
 * Remembers who ordered (to pre-fill the next checkout) and, with COOKIE_SECRET set, which order this browser just placed.
 * The signed cookie proves the orders it was issued for; ownership of an order is decided by that list, never by a phone
 * number someone typed (see viewer-owns-order.ts).
 */
export async function rememberContact(contact: unknown, orderId?: string): Promise<void> {
  const parsed = contactSchema.safeParse(contact);
  if (!parsed.success) return;
  const secret = cookieSecret();
  if (secret.kind === "invalid") return;

  const previous = secret.kind === "ok" ? ((await readPayload())?.contact.orders ?? []) : [];
  const payload = secret.kind === "ok" ? { ...parsed.data, orders: withOrder(previous, orderId ?? "").filter(Boolean) } : parsed.data;
  (await cookies()).set(COOKIE, encodeContactCookie(payload, secret.kind === "ok" ? secret.secret : undefined), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 180,
  });
}
