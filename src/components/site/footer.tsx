import Image from "next/image";
import Link from "next/link";
import { getOrg } from "@/lib/repositories/org";

/**
 * Site footer.
 *
 * Dark, as in the site design — the page ends on ink rather than fading out on
 * more cream, and the cream wordmark reads against it without needing the ink
 * variant the header uses.
 */
export async function Footer() {
  const org = await getOrg();
  return (
    <footer className="mt-auto bg-[var(--ink)] text-[var(--cream-hi)]">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-[var(--gutter)] py-12 sm:flex-row sm:justify-between">
        <div className="flex flex-col gap-2">
          <Image src="/frybird-wordmark.svg" alt="FRYBIRD" width={140} height={31} className="h-[28px] w-auto" />
          <p className="text-sm text-[var(--cream-2)]">Born crispy. Built bold.</p>
        </div>

        <div className="flex flex-col gap-2 text-sm" id="visit">
          <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--cream-2)]/70">Visit</p>
          <address className="not-italic leading-relaxed">
            Sector 9
            <br />
            Ambala City, Haryana
          </address>
        </div>

        <div className="flex flex-col gap-2 text-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--cream-2)]/70">Order</p>
          <Link
            href="/menu"
            className="flex min-h-[44px] items-center text-[var(--cream-2)] transition-colors hover:text-[var(--cream-hi)]"
          >
            Full menu
          </Link>
          <Link
            href="/cart"
            className="flex min-h-[44px] items-center text-[var(--cream-2)] transition-colors hover:text-[var(--cream-hi)]"
          >
            Your order
          </Link>
        </div>
      </div>

      <div className="border-t border-[var(--cream-hi)]/15">
        <p className="mx-auto w-full max-w-6xl px-[var(--gutter)] py-4 text-xs text-[var(--cream-2)]/70">
          {org?.gstin ? "Prices include GST." : "Prices are what you pay."}
        </p>
      </div>
    </footer>
  );
}
