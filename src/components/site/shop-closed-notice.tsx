import { Clock } from "lucide-react";
import { closedNoticeText } from "@/lib/cart/closed-copy";
import { isOpenAt, nextOpening } from "@/lib/orders/opening-hours";
import { cn } from "@/lib/utils";

/**
 * Says the shop is closed, and renders nothing at all when it is open.
 *
 * Server component: takes the organization's own hours and the server's
 * clock, so there is no client time to mis-hydrate. Display only — the
 * server's refusal at order time is the authority.
 */
export function ShopClosedNotice({
  openingTime,
  closingTime,
  now = new Date(),
  className,
}: {
  openingTime: string;
  closingTime: string;
  now?: Date;
  className?: string;
}) {
  if (isOpenAt(now, openingTime, closingTime)) return null;
  const { day } = nextOpening(now, openingTime, closingTime);
  return (
    <p role="status" className={cn("flex items-start gap-3 rounded-md border border-border bg-surface px-4 py-3 text-sm leading-relaxed", className)}>
      <Clock className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
      <span>{closedNoticeText(day, openingTime)}</span>
    </p>
  );
}
