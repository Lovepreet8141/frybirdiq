import { earnPreview } from "@/lib/loyalty/copy";
import { getLoyaltyConfig, getStampConfig } from "@/lib/loyalty/config";
import { getCustomer } from "@/lib/customer";
import { ZERO, type Paise } from "@/lib/money";
import { qualifyingStampSpend } from "@/lib/repositories/loyalty";

/**
 * "This order earns …" for the cart and checkout. `spend` is what the
 * customer will pay (after offers and points). Delivery is not earned on, and
 * the preview uses the loyalty ledger's own functions for the decision.
 */
export async function EarnPreview({ spend, className }: { spend: Paise; className?: string }) {
  const [loyalty, stamps, customer] = await Promise.all([getLoyaltyConfig(), getStampConfig(), getCustomer()]);
  // The ledger's own basis (grand total less delivery); the fee is not known yet
  // here, and is excluded from earning either way.
  const lines = earnPreview({ spend: qualifyingStampSpend(spend, ZERO), signedIn: customer !== null, loyalty, stamps });
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
