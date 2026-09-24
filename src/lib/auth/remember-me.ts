import "server-only";

/**
 * "Remember me": whether a session survives closing the browser (30 days,
 * rolling while used) or ends with it (a true session cookie — no Max-Age at
 * all). Signed with `COOKIE_SECRET`, same wire format and fail-closed
 * posture as `frybird_contact` (`src/lib/cart/contact-cookie.ts`'s own doc
 * comment) — these two encode/decode functions are generic (they take
 * `unknown`, not anything cart-specific) and are reused here rather than
 * duplicated.
 *
 * The tricky part is not this cookie itself, it's making every OTHER cookie
 * this app writes (Supabase's own session cookies) actually honor the
 * choice. `@supabase/ssr` (installed: 0.12.7) has a real bug for this
 * purpose: `createServerClient`'s documented `cookieOptions.maxAge` is
 * silently discarded — `applyServerStorage`
 * (node_modules/@supabase/ssr/dist/main/cookies.js:466-471) unconditionally
 * overwrites it back to the library's own hardcoded 400-day default on every
 * real session write, no matter what's passed in. The only place left that
 * actually decides what reaches the browser is our own `setAll` callback
 * (`src/lib/supabase/server.ts`, `src/proxy.ts`) — it receives the exact
 * `{name, value, options}` list the library wants written and is free to
 * rewrite `options.maxAge` before the real cookie store call. `withRememberMaxAge`
 * below is that rewrite, shared by both call sites so the fix lives in one
 * place.
 */

import { z } from "zod";
import { cookieSecret } from "@/lib/env";
import { decodeContactCookie, encodeContactCookie } from "@/lib/cart/contact-cookie";

export const REMEMBER_COOKIE_NAME = "frybird_remember";

/** 30 days, in seconds — the one number this whole mechanism exists to apply (or not) to every session cookie. */
export const REMEMBER_MAX_AGE = 60 * 60 * 24 * 30;

const payloadSchema = z.object({ remember: z.boolean() });

/**
 * Decodes an already-read raw cookie value into a definite choice, or
 * `undefined` if the cookie is simply absent — environment-agnostic (no
 * `next/headers`), so both the Server Action/RSC path and the middleware
 * (which reads cookies through `NextRequest`, not `cookies()`) can call it.
 *
 * A cookie that IS present but unsigned, wrongly signed, or unparsable
 * resolves to `false` (session-only) — the shorter lifetime is always the
 * safe direction to fail toward — but a cookie that was simply never set
 * (a session that predates this mechanism entirely) resolves to
 * `undefined` so the caller can apply its own default for that case.
 */
export function decodeRememberChoice(raw: string | undefined): boolean | undefined {
  if (!raw) return undefined;
  const secret = cookieSecret();
  if (secret.kind !== "ok") return false;
  const parsed = payloadSchema.safeParse(decodeContactCookie(raw, secret.secret));
  return parsed.success ? parsed.data.remember : false;
}

/**
 * The signed value to write for a given choice, or `null` if `COOKIE_SECRET`
 * isn't configured (the caller logs and skips the write in that case — same
 * fail-closed posture as `frybird_contact`, never an unsigned cookie).
 */
export function encodeRememberChoice(remember: boolean): string | null {
  const secret = cookieSecret();
  if (secret.kind !== "ok") return null;
  return encodeContactCookie({ remember }, secret.secret);
}

/** Cookie attributes for `frybird_remember` itself — httpOnly, never read or written by client JS. */
export function rememberCookieOptions(remember: boolean): {
  httpOnly: true;
  sameSite: "lax";
  secure: boolean;
  path: "/";
  maxAge: number | undefined;
} {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: remember ? REMEMBER_MAX_AGE : undefined,
  };
}

/**
 * Rewrites one Supabase cookie write's `maxAge` to match the remember-me
 * choice — the actual workaround described above.
 *
 * `@supabase/ssr`'s `applyServerStorage` only ever passes two literal
 * `maxAge` values into `setAll`: exactly `0` for a deliberate removal (sign
 * -out, clearing a now-stale cookie chunk — the library's own sentinel,
 * same file, `removeCookieOptions.maxAge = 0`) and its own 400-day default
 * for every real "establish or extend this session" write. A removal must
 * be left completely alone; only the latter gets remapped. If a future
 * `@supabase/ssr` version changes these sentinels, this stops being a
 * reliable signal and needs re-verifying against the new source.
 */
export function withRememberMaxAge<T extends { maxAge?: number }>(options: T, remember: boolean): T {
  if (options.maxAge === 0) return options;
  return { ...options, maxAge: remember ? REMEMBER_MAX_AGE : undefined };
}
