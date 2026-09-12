import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { clientEnv, isSupabaseConfigured } from "@/lib/env";

/**
 * Where a confirmation email link lands.
 *
 * PKCE, not the implicit flow this route was first built for and wrongly
 * assumed: Supabase's own `/verify` endpoint exchanges the emailed token and
 * redirects here with `?code=<uuid>` in the query string, not a session in a
 * URL fragment. A query string reaches the server, so this needs no
 * client-side JavaScript at all — `exchangeCodeForSession` reads the
 * matching `code_verifier` cookie that `signUp()` set on this browser and
 * turns the code into a real session, entirely server-side.
 *
 * Redirect targets are relative `Location` headers, not
 * `NextResponse.redirect(new URL(path, request.url))` — see
 * `/api/auth/sign-out/route.ts`'s comment. `request.url` cannot be trusted
 * to resolve to the real domain on this deployment.
 */
export async function GET(request: Request) {
  const code = new URL(request.url).searchParams.get("code");

  if (!code) {
    return new NextResponse(null, { status: 307, headers: { Location: "/account/sign-in" } });
  }

  if (!isSupabaseConfigured()) {
    return new NextResponse(null, { status: 307, headers: { Location: "/account/sign-in?confirm=error" } });
  }

  const response = new NextResponse(null, { status: 307, headers: { Location: "/account" } });
  const cookieStore = await cookies();
  const env = clientEnv();
  const supabase = createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (list) => {
        for (const { name, value, options } of list) response.cookies.set(name, value, options);
      },
    },
  });

  // An already-used or expired code fails here rather than throwing — the
  // link was real, it just doesn't work a second time or after its window
  // closes. That is a plain, expected state, not a crash.
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    return new NextResponse(null, { status: 307, headers: { Location: "/account/sign-in?confirm=error" } });
  }

  return response;
}
