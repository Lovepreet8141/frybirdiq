/**
 * Provider registry.
 *
 * Order and checkout code resolves a provider by name and never imports one
 * directly. Adding Razorpay is a line in this file plus a new module.
 */

import { CASH_PROVIDER, cashProvider } from "./cash";
import type { PaymentMethod, PaymentProvider } from "./provider";

const PROVIDERS: Readonly<Record<string, PaymentProvider>> = {
  [CASH_PROVIDER]: cashProvider,
};

export function getProvider(name: string): PaymentProvider {
  const provider = PROVIDERS[name];
  if (!provider) throw new Error(`payments: no provider named "${name}"`);
  return provider;
}

/**
 * What a customer may choose at checkout.
 *
 * Cash only for now — online payment is Phase 2 and there are no gateway
 * credentials. This is a list, not a constant, so adding Razorpay changes what
 * checkout offers without changing how checkout works.
 */
export function availableMethods(): readonly { method: PaymentMethod; provider: string; label: string; detail: string }[] {
  return [
    {
      method: "CASH",
      provider: CASH_PROVIDER,
      label: "Pay on collection",
      detail: "Cash, UPI or card at the counter.",
    },
  ];
}

export { CASH_PROVIDER, cashProvider };
export * from "./provider";
