/**
 * Server Supabase clients.
 *
 * `createServerClient()` acts as the signed-in user and stays inside row-level
 * security. `createAdminClient()` bypasses RLS entirely and exists only for
 * migrations, seeding and webhook handlers that run with no user session —
 * never for anything reached from a request that a user controls.
 */
import "server-only";

import { createServerClient as createSupabaseServerClient } from "@supabase/ssr";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { clientEnv, serverEnv } from "@/lib/env";
import {
  REMEMBER_COOKIE_NAME,
  decodeRememberChoice,
  encodeRememberChoice,
  rememberCookieOptions,
  rememberSecretOk,
  withRememberMaxAge,
} from "@/lib/auth/remember-me";

export async function createServerClient() {
  const env = clientEnv();
  const cookieStore = await cookies();

  return createSupabaseServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (list) => {
        try {
          // No cheap way to know customer vs. staff/owner at this layer (both share the one
          // createServerClient factory, sometimes before identity is even resolved) — see
          // remember-me.ts's own doc comment. Defaults to remembered — matching the
          // middleware's default, an existing session that predates this mechanism entirely
          // is never cut short by it — but only when COOKIE_SECRET is actually working; if
          // it's broken, an absent marker means no choice was ever recorded, and the
          // fail-safe direction is session-only, not remembered (red-team finding).
          const remember = decodeRememberChoice(cookieStore.get(REMEMBER_COOKIE_NAME)?.value) ?? rememberSecretOk();
          let wroteSession = false;
          for (const { name, value, options } of list) {
            cookieStore.set(name, value, withRememberMaxAge(options, remember));
            if (options.maxAge !== 0) wroteSession = true;
          }
          // Rolling: every time a remembered session is actually refreshed or established,
          // the marker cookie's own 30 days resets too, in lockstep with the auth cookies.
          if (wroteSession && remember) {
            const marker = encodeRememberChoice(true);
            if (marker) cookieStore.set(REMEMBER_COOKIE_NAME, marker, rememberCookieOptions(true));
          }
        } catch {
          // Called from a Server Component, where cookies are read-only. The
          // middleware refreshes the session instead, so this is safe to drop.
        }
      },
    },
  });
}

/** Bypasses row-level security. Justify every call site. */
export function createAdminClient() {
  const env = clientEnv();
  const { SUPABASE_SERVICE_ROLE_KEY } = serverEnv();

  return createSupabaseClient(env.NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
