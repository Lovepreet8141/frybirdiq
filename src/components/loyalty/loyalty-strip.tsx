import Link from "next/link";
import { Gift } from "lucide-react";
import { pointsRule, stampRuleShort } from "@/lib/loyalty/copy";
import { getLoyaltyConfig, getStampConfig } from "@/lib/loyalty/config";

/**
 * The programme in one glance, where the customer is choosing food (the
 * menu). Every figure is derived from the loyalty configs; renders nothing
 * when neither programme is on.
 */
export async function LoyaltyStrip({ className }: { className?: string }) {
  const [loyalty, stamps] = await Promise.all([getLoyaltyConfig(), getStampConfig()]);
  const lines = [stampRuleShort(stamps), pointsRule(loyalty)].filter((line): line is string => line !== null);
  if (lines.length === 0) return null;

  return (
    <div className={`flex items-start gap-3 rounded-md border border-border bg-surface px-4 py-3 text-sm leading-relaxed ${className ?? ""}`}>
      <Gift className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
      <div>
        <p className="font-semibold">FRYBIRD REWARDS</p>
        {lines.map((line) => (
          <p key={line} className="text-muted-foreground">
            {line}
          </p>
        ))}
        <Link href="/#loyalty" className="inline-flex min-h-[44px] items-center font-semibold underline underline-offset-2">
          How it works
        </Link>
      </div>
    </div>
  );
}
