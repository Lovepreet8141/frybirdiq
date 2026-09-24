import "server-only";

/**
 * `next/headers`-based convenience wrappers around `remember-me.ts`'s pure
 * functions, for Server Actions and Route Handlers — kept separate from
 * `remember-me.ts` itself so `src/proxy.ts` (which reads/writes cookies
 * through `NextRequest`/`NextResponse`, not `next/headers`) can import the
 * pure logic without pulling this in.
 */

import { cookies } from "next/headers";
import { REMEMBER_COOKIE_NAME, decodeRememberChoice, encodeRememberChoice, rememberCookieOptions } from "./remember-me";

/** The current request's remember-me choice, or `defaultForExisting` if the cookie was never set at all. */
export async function readRememberChoice(defaultForExisting: boolean): Promise<boolean> {
  const raw = (await cookies()).get(REMEMBER_COOKIE_NAME)?.value;
  return decodeRememberChoice(raw) ?? defaultForExisting;
}

/**
 * Sets the remember-me choice for the session about to be established. Call
 * this BEFORE the Supabase auth call that creates it (`signInWithPassword`,
 * `verifyOtp`) — that call's own cookie writes go through the same
 * request's cookie jar, so `createServerClient`'s `setAll` sees the new
 * choice immediately, not whatever was there before this request.
 */
export async function setRememberChoice(remember: boolean): Promise<void> {
  const value = encodeRememberChoice(remember);
  if (value === null) {
    console.error(
      "remember-me: COOKIE_SECRET is unset or invalid — the choice cannot be signed, this session will behave as session-only",
    );
    return;
  }
  (await cookies()).set(REMEMBER_COOKIE_NAME, value, rememberCookieOptions(remember));
}

/** Clears the remember-me cookie itself. Sign-out calls this alongside Supabase's own `signOut()`, which only clears its own cookies. */
export async function clearRememberChoice(): Promise<void> {
  (await cookies()).delete(REMEMBER_COOKIE_NAME);
}
