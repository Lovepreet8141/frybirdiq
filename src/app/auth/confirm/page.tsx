"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

/**
 * Where a confirmation email link lands.
 *
 * This project's Supabase Auth email template still uses the default
 * `{{ .ConfirmationURL }}`, which verifies on Supabase's own domain and
 * redirects back here with the session in the URL **fragment**
 * (`#access_token=...&refresh_token=...`) rather than a `?code=` a server
 * could read — a fragment never reaches the server at all. So this has to be
 * a client page: the browser Supabase client picks the fragment up on
 * mount (it persists to cookies, same as everywhere else in this app) and
 * this just waits for that, then hands off to `/account`.
 *
 * An expired or already-used link comes back as `#error=...&error_code=...`
 * instead of a session — handled the same way, as a plain state rather than
 * a redirect to a page that would just bounce them again.
 */
type Phase = "working" | "expired" | "used" | "error";

// Set explicitly rather than relying on the client's own `detectSessionInUrl`
// auto-processing — that didn't reliably pick up this exact redirect shape in
// testing (Supabase's own `/verify` endpoint appends an extra empty `sb` param
// to the fragment). Reading the tokens straight out of the hash and calling
// `setSession` is the documented, deterministic alternative, and this is the
// one place in the app that legitimately reads the hash: it never reaches the
// server, so nothing else could have handled it.
interface Init {
  phase: Phase;
  tokens: { access_token: string; refresh_token: string } | null;
}

/** Read once, before the first render, so an invalid link never has to render "working" first. */
function init(): Init {
  if (typeof window === "undefined") return { phase: "working", tokens: null };

  const hash = new URLSearchParams(window.location.hash.slice(1));
  const errorCode = hash.get("error_code");
  if (errorCode) return { phase: errorCode === "otp_expired" ? "expired" : "used", tokens: null };

  const access_token = hash.get("access_token");
  const refresh_token = hash.get("refresh_token");
  if (!access_token || !refresh_token) return { phase: "error", tokens: null };

  return { phase: "working", tokens: { access_token, refresh_token } };
}

export default function ConfirmPage() {
  const router = useRouter();
  const [{ phase, tokens }, setState] = useState<Init>(init);

  useEffect(() => {
    if (phase !== "working" || !tokens) return;

    let settled = false;
    const supabase = createClient();
    supabase.auth.setSession(tokens).then(({ error }) => {
      settled = true;
      if (error) {
        setState({ phase: "error", tokens: null });
      } else {
        router.replace("/account");
      }
    });

    const timeout = setTimeout(() => {
      if (!settled) setState({ phase: "error", tokens: null });
    }, 8000);

    return () => clearTimeout(timeout);
  }, [router, phase, tokens]);

  if (phase === "working") {
    return (
      <div className="mx-auto flex w-full max-w-sm flex-col items-center gap-4 px-[var(--gutter)] py-24 text-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" aria-hidden="true" />
        <p className="text-sm text-muted-foreground">Confirming your account…</p>
      </div>
    );
  }

  const copy =
    phase === "expired"
      ? { title: "That link has expired.", detail: "Confirmation links are only good for a while. Request a new one from the sign-in page." }
      : phase === "used"
        ? { title: "That link has already been used.", detail: "If your account is already confirmed, just sign in." }
        : { title: "That link didn't work.", detail: "It may have expired or already been used. Request a new one from the sign-in page." };

  return (
    <div className="mx-auto flex w-full max-w-sm flex-col items-center gap-4 px-[var(--gutter)] py-24 text-center">
      <h1 className="font-heading text-xl font-bold">{copy.title}</h1>
      <p className="text-sm text-muted-foreground">{copy.detail}</p>
      <Link href="/account/sign-in" className="mt-2 inline-flex min-h-[44px] items-center font-semibold text-primary">
        Go to sign in
      </Link>
    </div>
  );
}
