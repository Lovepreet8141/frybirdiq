"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Gift, Loader2 } from "lucide-react";
import { setRedeemReward } from "@/lib/cart/actions";
import { cn } from "@/lib/utils";

/**
 * "Make this my FRYBIRD REWARDS free item" — the direct, on-the-website
 * selection the reward asks for, right where the customer is already
 * looking at the price. Toggling one line off automatically clears any
 * other, since only one line can be the redemption at a time.
 */
export function RedeemToggle({ lineKey, active }: { lineKey: string; active: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const toggle = () =>
    startTransition(async () => {
      await setRedeemReward({ key: lineKey, redeem: !active });
      router.refresh();
    });

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={pending}
      aria-pressed={active}
      className={cn(
        "flex min-h-[44px] cursor-pointer items-center gap-1.5 rounded-full border px-3 text-xs font-semibold transition-colors disabled:opacity-60",
        active
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border text-muted-foreground hover:border-border-strong hover:text-foreground",
      )}
    >
      {pending ? (
        <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
      ) : (
        <Gift className="size-3.5" aria-hidden="true" />
      )}
      {active ? "Your free item" : "Make this free"}
    </button>
  );
}
