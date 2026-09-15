import type { Metadata } from "next";
import Link from "next/link";
import { AcceptInviteForm } from "@/components/auth/accept-invite-form";

export const metadata: Metadata = { title: "Set your password", robots: { index: false, follow: false } };

/**
 * Where a staff invite email lands. Roadmap 6.1. Unauthenticated by design —
 * the whole point is that this account has no password yet — so unlike
 * `/app/*` there is nothing to gate here server-side; the form itself refuses
 * to do anything until the browser has processed a real invite link. See
 * `AcceptInviteForm`'s own comment for how that session gets there.
 */
export default function AcceptInvitePage() {
  return (
    <div className="flex min-h-full flex-col items-center justify-center px-[var(--gutter)] py-16">
      <div className="flex w-full max-w-sm flex-col gap-8">
        <div className="flex flex-col gap-2">
          <Link href="/" className="font-heading text-sm font-bold uppercase tracking-[0.08em] text-muted-foreground">
            FRYBIRD
          </Link>
          <h1 className="font-heading text-4xl font-bold tracking-tight">
            FRYBIRD <span className="text-primary">IQ</span>
          </h1>
          <p className="text-sm leading-relaxed text-muted-foreground">You&rsquo;ve been invited to the counter and kitchen. Set a password to get in.</p>
        </div>

        <AcceptInviteForm />
      </div>
    </div>
  );
}
