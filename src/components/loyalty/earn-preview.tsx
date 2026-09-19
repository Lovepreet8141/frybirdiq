import { earnPreview } from "@/lib/loyalty/copy";
import { getLoyaltyConfig, getStampConfig } from "@/lib/loyalty/config";
import { getCustomer } from "@/lib/customer";
import type { Paise } from "@/lib/money";

/**
 * "This order earns …" for the cart and checkout. `spend` is what the
 * customer will pay for the food; delivery is not earned on. A preview: the
 * stamp and points land when payment does.
 */
export async function EarnPreview({ spend, className }: { spend: Paise; className?: string }) {
  const [loyalty, stamps, customer] = await Promise.all([getLoyaltyConfig(), getStampConfig(), getCustomer()]);
  const lines = earnPreview({ spend, signedIn: customer !== null, loyalty, stamps });
  if (lines.length === 0) return null;
  return (
    <div className={className}>
      {lines.map((line) => (
        <p key={line} className="px-1 text-sm text-muted-foreground">
          {line}
        </p>
      ))}
    </div>
  );
}
