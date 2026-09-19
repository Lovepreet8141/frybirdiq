import type { Metadata } from "next";
import Link from "next/link";
import "./(home)/frybird-home.css";
import { HomeNav } from "@/components/home/nav";

export const metadata: Metadata = { title: "Page not found", robots: { index: false } };

/**
 * The 404 for any address the site does not have (and for `notFound()` on a
 * missing item or order). Same header as the rest of the customer
 * site, with two ways back, so a mistyped or expired link ends on the menu
 * rather than on a bare "404" with nowhere to go. Rendered outside the
 * (site) layout, hence the header here. Kept static on purpose: no cookies
 * (`signedIn` is false) and no database (so no Footer, which reads the org),
 * because this page is prerendered at build and must render when the
 * database is down.
 */
export default function NotFound() {
  return (
    <>
      <HomeNav signedIn={false} />
      <div className="flex min-h-full flex-1 flex-col pt-[var(--nav-h)]">
        <main className="flex flex-1 items-center">
          <div className="mx-auto w-full max-w-xl px-[var(--gutter)] py-16 text-center">
            <p className="text-xs font-semibold uppercase tracking-[0.08em] text-primary">Page not found</p>
            <h1 className="mt-3 font-heading text-4xl font-bold tracking-tight sm:text-5xl">That page isn&rsquo;t on the menu.</h1>
            <p className="mt-4 text-lg leading-relaxed text-muted-foreground">
              The link may be mistyped or out of date. If you were tracking an order, open the link from your confirmation again.
            </p>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              <Link
                href="/menu"
                className="inline-flex min-h-[48px] items-center justify-center rounded-md bg-primary px-6 text-base font-semibold text-primary-foreground hover:opacity-90"
              >
                See the menu
              </Link>
              <Link
                href="/"
                className="inline-flex min-h-[48px] items-center justify-center rounded-md border border-border px-6 text-base font-semibold hover:bg-surface-muted"
              >
                Back home
              </Link>
            </div>
          </div>
        </main>
      </div>
    </>
  );
}
