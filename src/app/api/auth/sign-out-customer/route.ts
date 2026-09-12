import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { clientEnv, isSupabaseConfigured } from "@/lib/env";

/**
 * Customer sign-out. Same fix as `/api/auth/sign-out`, same reason — see that
 * route's comment. The only difference is the redirect target.
 */
export async function POST(request: Request) {
  const response = NextResponse.redirect(new URL("/", request.url));
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
