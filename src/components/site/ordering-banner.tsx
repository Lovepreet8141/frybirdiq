import { Clock, PauseCircle } from "lucide-react";
import { CallShop } from "@/components/site/call-shop";
import { shopPhone } from "@/lib/contact/phone";
import { orderingBanner } from "@/lib/cart/ordering-banner";
import { getCustomerOrderingStatus } from "@/lib/cart/ordering-status";
import { getStoreContact } from "@/lib/repositories/org";
import { cn } from "@/lib/utils";

/**
 * The one banner: closed by hours, or paused by the Close Shop switch. Nothing
 * at all while open. Sits in the page content (never in or against the fixed
 * top bar), as a bordered card with a coloured edge so it reads as a notice
 * about the shop. A server component: the state is the server's answer at
 * render, announced by its place in the reading order.
 */
export async function OrderingBanner({ className }: { className?: string }) {
  const status = await getCustomerOrderingStatus();
  const copy = status ? orderingBanner(status) : null;
  if (!copy) return null;
  const phone = shopPhone((await getStoreContact())?.phone);
  const Icon = copy.kind === "paused" ? PauseCircle : Clock;

  return (
    <div
      role="status"
      data-ordering-banner={copy.kind}
      className={cn(
        "flex items-start gap-3 rounded-lg border border-border border-l-[6px] border-l-primary bg-surface px-4 py-3 text-foreground",
        className,
      )}
    >
      <Icon className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden="true" />
      <div className="min-w-0 text-sm leading-relaxed">
        <p className="text-base font-bold">{copy.headline}</p>
        {copy.detail && <p>{copy.detail}</p>}
        {phone && (
          <p className="mt-1">
            <CallShop phone={phone} lead="Questions? Call" />
          </p>
        )}
      </div>
    </div>
  );
}
