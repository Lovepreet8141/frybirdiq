import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * The `frybird_contact` cookie's wire format (cookie-sign-1).
 *
 * The cookie remembers who ordered last on this device, and `/order/[id]` treats a matching phone in it as "this
 * browser belongs to the person who placed the order" (`viewerOwnsOrder`). It used to be plain JSON, so anyone could type
 * a victim's phone number into their own cookie and read the victim's order page. With a secret configured
 * (`COOKIE_SECRET`) the cookie is `v1.<base64url json>.<base64url HMAC-SHA256>` and only a cookie this server signed is
 * believed. With no secret configured it is the plain JSON it always was, so nothing changes until the secret is set.
 *
 * A plain or wrongly signed cookie, once a secret is set, is simply treated as absent: the returning customer types their
 * details once and the cookie is re-issued signed. A signed cookie with no secret configured fails closed (it cannot be
 * verified), e.g. after the secret is removed.
 */

const VERSION = "v1";

const sign = (body: string, secret: string) => createHmac("sha256", secret).update(`${VERSION}.${body}`).digest("base64url");

export function encodeContactCookie(contact: unknown, secret?: string): string {
  const json = JSON.stringify(contact);
  if (!secret) return json;
  const body = Buffer.from(json, "utf8").toString("base64url");
  return `${VERSION}.${body}.${sign(body, secret)}`;
}

/** The parsed value, or null when the cookie is missing, malformed, or not trustworthy. Never throws. */
export function decodeContactCookie(raw: string, secret?: string): unknown | null {
  try {
    if (!raw) return null;
    if (!secret) {
      if (raw.startsWith(`${VERSION}.`)) return null; // signed, but nothing to verify it with: fail closed
      return JSON.parse(raw) as unknown;
    }
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
