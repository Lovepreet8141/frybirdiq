import Link from "next/link";
import { redirect } from "next/navigation";
import { LogOut } from "lucide-react";
import { getStaff } from "@/lib/auth";
import { signOut } from "@/lib/auth/actions";
import { resolveHome } from "@/lib/auth/route-home";

/**
 * The staff portal shell. BUILD-PLAN.md §9: "Use route-level authorization."
 *
 * The gate is here, in a Server Component, not in middleware. Middleware runs
 * on a matcher and cannot see whether this person holds a membership of this
 * organization — an authenticated stranger would sail through it. Every screen
 * inside this layout is behind this check, and every action re-checks its own
 * permission because rendering a screen is not authorization for the actions
 * on it.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const staff = await getStaff();
  if (!staff) {
    // A signed-in customer who lands here is sent to their own account. Sending
    // everyone to /sign-in would bounce them between two pages that each think
    // the other is where they belong.
    const home = await resolveHome();
    redirect(home.kind === "customer" ? "/account" : "/sign-in");
  }

  return (
    <div className="flex min-h-full flex-col">
      <header className="border-b border-border">
        <div className="mx-auto flex h-[68px] w-full max-w-6xl items-center justify-between gap-4 px-[var(--gutter)]">
          <div className="flex items-center gap-6">
            <Link href="/app/orders" className="flex min-h-[44px] items-center font-heading text-lg font-bold tracking-tight">
              FRYBIRD <span className="text-primary">IQ</span>
              <span className="ml-2 text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                Counter
              </span>
            </Link>
          </div>

          <div className="flex items-center gap-4">
            <span className="hidden text-sm text-muted-foreground sm:inline">
              {staff.displayName}
              <span className="ml-2 text-xs uppercase tracking-[0.08em]">{staff.roles.join(" · ")}</span>
            </span>
            <form action={signOut}>
              <button
                type="submit"
                className="flex min-h-[44px] items-center gap-2 rounded-md border border-border px-3 text-sm font-semibold transition-colors hover:bg-surface"
              >
                <LogOut className="size-4" aria-hidden="true" />
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>

      <main className="flex-1">{children}</main>
    </div>
  );
}
