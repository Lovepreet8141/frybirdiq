import { type NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { clientEnv, isSupabaseConfigured } from "@/lib/env";

/**
 * Refreshes the Supabase session on every request.
 *
 * Next 16 calls this a "proxy"; it is what earlier versions called middleware.
 *
 * Access tokens are short-lived. Without this the refresh only happens in the
 * browser, and a Server Component rendering a staff screen sees an expired
 * token and signs the cashier out mid-shift.
 *
 * This only *refreshes*. It does not authorize — §41 requires that server-side
 * at the point of use, and a path matcher is a routing rule, not a permission
 * check. It cannot see whether this person holds a membership of this
 * organization, so an authenticated stranger would sail through it. The `/app`
 * layout does the real gate.
 */
export async function proxy(request: NextRequest) {
  if (!isSupabaseConfigured()) return NextResponse.next();

  let response = NextResponse.next({ request });
  const env = clientEnv();

  const supabase = createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list) => {
        for (const { name, value } of list) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of list) response.cookies.set(name, value, options);
      },
    },
  });

  // Touching the user is what performs the refresh. Do not remove.
  await supabase.auth.getUser();

  return response;
}

export const config = {
  matcher: [
    // Everything except static assets and images.
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif)$).*)",
  ],
};
