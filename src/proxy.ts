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

  // Keep every signed-in surface out of the browser's back-forward cache.
  //
  // Next's own Cache-Control for a dynamic page is `no-cache, must-revalidate`
  // — enough to stop a stale copy being served on a normal reload, but bfcache
  // eligibility in Chromium, Firefox and Safari is keyed on `no-store`
  // specifically, and that header cannot be set from next.config.js's
  // `headers()` — the framework re-asserts its own Cache-Control on a
  // dynamic page's response after config-level headers are applied, so this
  // has to happen here, on the way out of the one place that already touches
  // every request. Without it, `no-cache` still lets the browser snapshot the
  // fully rendered page and restore it instantly on history back/forward with
  // no request to the server at all — so a sign-out that correctly clears the
  // session cookie has nothing to check on that path, and whoever presses
  // back next sees the previous person's fully rendered, still-interactive
  // account or counter screen. That is the exact "shared device, next person
  // gets the previous person's account" report this fixes.
  if (/^\/(app|account)(\/|$)/.test(request.nextUrl.pathname)) {
    response.headers.set("Cache-Control", "no-store");
  }

  return response;
}

export const config = {
  matcher: [
    // Everything except static assets and images.
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif)$).*)",
  ],
};
