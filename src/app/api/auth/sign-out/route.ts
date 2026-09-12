import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { clientEnv, isSupabaseConfigured } from "@/lib/env";

/**
 * Staff sign-out.
 *
 * A Route Handler, not a Server Action, and that choice is load-bearing: a
 * Server Action that calls `cookies().set()` and then `redirect()` in the
 * same call does not reliably carry those cookie writes onto the redirect
 * response on this Next.js version — the session cookie survives the sign-out
 * even though the write itself throws no error. That is the exact "signing
 * out doesn't sign out" report this fixes. A Route Handler sidesteps it by
 * attaching the deletion directly to the `NextResponse` it returns, with no
 * ambient cookie jar and no `redirect()` special-case in between.
 */
export async function POST(request: Request) {
  const response = NextResponse.redirect(new URL("/sign-in", request.url));
  if (!isSupabaseConfigured()) return response;

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

  await supabase.auth.signOut();
  revalidatePath("/", "layout");
  return response;
}
