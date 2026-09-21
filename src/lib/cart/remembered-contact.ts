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
import { serverEnv } from "@/lib/env";
import { decodeContactCookie, encodeContactCookie } from "./contact-cookie";

const COOKIE = "frybird_contact";

const schema = z.object({
  name: z.string().min(1).max(80),
  phone: z.string().regex(/^[6-9]\d{9}$/),
  email: z.string().email().max(160),
});

export type RememberedContact = z.infer<typeof schema>;

export async function readRememberedContact(): Promise<RememberedContact | null> {
  const raw = (await cookies()).get(COOKIE)?.value;
  if (!raw) return null;
  // With COOKIE_SECRET set only a cookie this server signed is believed (cookie-sign-1); unset, the plain JSON as before.
  const parsed = schema.safeParse(decodeContactCookie(raw, serverEnv().COOKIE_SECRET));
  return parsed.success ? parsed.data : null;
}

export async function rememberContact(contact: unknown): Promise<void> {
  const parsed = schema.safeParse(contact);
  if (!parsed.success) return;

  (await cookies()).set(COOKIE, encodeContactCookie(parsed.data, serverEnv().COOKIE_SECRET), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 180,
  });
}
