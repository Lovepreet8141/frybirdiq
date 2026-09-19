import { Phone } from "lucide-react";
import type { ShopPhone } from "@/lib/contact/phone";

/**
 * "Call us" line. Renders nothing when the shop has no phone on record — no
 * dead instruction, no empty link.
 */
export function CallShop({ phone, lead = "Need a hand? Call" }: { phone: ShopPhone | null; lead?: string }) {
  if (!phone) return null;
  return (
    <span className="inline-flex flex-wrap items-center gap-x-1.5">
      <Phone className="size-4 shrink-0 text-primary" aria-hidden="true" />
      <span>{lead}</span>
      <a href={phone.href} className="inline-flex min-h-[44px] items-center font-semibold underline underline-offset-2">
        {phone.display}
      </a>
    </span>
  );
}
