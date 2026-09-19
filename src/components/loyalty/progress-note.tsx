import { Flame } from "lucide-react";
import { getCustomer } from "@/lib/customer";
import { stampProgress } from "@/lib/loyalty/copy";
import { getStampConfig } from "@/lib/loyalty/config";
import { getStampAccountState } from "@/lib/repositories/loyalty";
import { getOrg } from "@/lib/repositories/org";

/**
 * The signed-in customer's own card, on their order page: "3 of 8 — 5 more
 * orders to a free item". Only for a verified account looking at its own
 * order (`show`), and only their own ledger; a guest or a link-holder sees
 * nothing. Read-only over the loyalty repository.
 */
export async function ProgressNote({ show, orderCarriesReward = false }: { show: boolean; orderCarriesReward?: boolean }) {
  if (!show) return null;
  const [customer, config, org] = await Promise.all([getCustomer(), getStampConfig(), getOrg()]);
  if (!customer?.emailVerified || !org) return null;
  const state = await getStampAccountState(customer.id, org.id);
  const progress = stampProgress(state?.stampCount ?? 0, state?.availableRewards.length ?? 0, config);
  if (!progress) return null;
  // This order already carries the free item; "ready — add it at checkout" would be stale.
  if (progress.ready && orderCarriesReward) return null;
  return (
    <p className="tabular mt-3 flex items-center gap-2 text-sm text-muted-foreground">
      <Flame className="size-4 shrink-0 text-primary" aria-hidden="true" />
      {progress.text}
    </p>
  );
}
