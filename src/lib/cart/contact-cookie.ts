import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * The `frybird_contact` cookie's wire format (cookie-sign-1).
 *
 * The cookie remembers who ordered last on this device, and `/order/[id]` treats a matching phone in it as "this
 * browser belongs to the person who placed the order" (`viewerOwnsOrder`). It used to be plain JSON, so anyone could type
 * a victim's phone number into their own cookie and read the victim's order page. The cookie is `v1.<base64url
 * json>.<base64url HMAC-SHA256>`, keyed by `COOKIE_SECRET`, and only a cookie this server signed is believed.
 *
 * A signature alone is not enough (found in review): anyone can place an order typing a victim's phone number and be issued a
 * validly signed cookie for it. So the signed cookie also carries the ids of the orders THIS browser placed, and ownership of an
 * order is decided by that list (`viewerOwnsOrder`), never by the phone in the cookie.
 *
 * A secret is required — there is no unsigned fallback (removed post-launch: `cookie-secret-dependency`). Without
 * `COOKIE_SECRET` configured, `src/lib/cart/remembered-contact.ts` never calls these at all: it fails closed, treats every
 * cookie as absent, and logs an alert. A wrongly signed cookie is simply treated as absent: the returning customer types
 * their details once and the cookie is re-issued signed.
 */

const VERSION = "v1";

const sign = (body: string, secret: string) => createHmac("sha256", secret).update(`${VERSION}.${body}`).digest("base64url");

export function encodeContactCookie(contact: unknown, secret: string): string {
  const body = Buffer.from(JSON.stringify(contact), "utf8").toString("base64url");
  return `${VERSION}.${body}.${sign(body, secret)}`;
}

/** The parsed value, or null when the cookie is missing, malformed, or wrongly signed. Never throws. */
export function decodeContactCookie(raw: string, secret: string): unknown | null {
  try {
    if (!raw) return null;
    const parts = raw.split(".");
    if (parts.length !== 3 || parts[0] !== VERSION) return null;
    const [, body, mac] = parts as [string, string, string];
    const expected = Buffer.from(sign(body, secret));
    const given = Buffer.from(mac);
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
    return JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as unknown;
  } catch {
    return null;
  }
}

/** How many of this browser's most recent orders the cookie remembers. */
export const MAX_REMEMBERED_ORDERS = 20;

/** The order ids this browser has placed with `orderId` added first: no duplicates, at most the newest MAX_REMEMBERED_ORDERS. */
export function withOrder(existing: readonly string[] | undefined, orderId: string): readonly string[] {
  return [orderId, ...(existing ?? []).filter((id) => id !== orderId)].slice(0, MAX_REMEMBERED_ORDERS);
}
