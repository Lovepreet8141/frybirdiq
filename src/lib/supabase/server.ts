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

export async function createServerClient() {
  const env = clientEnv();
  const cookieStore = await cookies();

  return createSupabaseServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (list) => {
        try {
          for (const { name, value, options } of list) cookieStore.set(name, value, options);
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
