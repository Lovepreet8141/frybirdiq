/**
 * Provider registry.
 *
 * Order and checkout code resolves a provider by name and never imports one
 * directly. Razorpay is a line in this file plus its own module — and it
 * resolves only when its keys are present, so a name lookup can never route
 * real money through a provider that cannot verify it.
 */

import { CASH_PROVIDER, cashProvider } from "./cash";
import type { PaymentMethod, PaymentProvider } from "./provider";
import { RAZORPAY_PROVIDER, isRazorpayConfigured, razorpayProvider } from "./razorpay";

const PROVIDERS: Readonly<Record<string, PaymentProvider>> = {
  [CASH_PROVIDER]: cashProvider,
  [RAZORPAY_PROVIDER]: razorpayProvider,
};

export function getProvider(name: string): PaymentProvider {
  const provider = PROVIDERS[name];
  if (!provider) throw new Error(`payments: no provider named "${name}"`);
  if (name === RAZORPAY_PROVIDER && !isRazorpayConfigured()) throw new Error("payments: razorpay is not configured");
  return provider;
}

export interface CheckoutMethod {
  readonly method: PaymentMethod;
  readonly provider: string;
  /** The value the checkout form posts. */
  readonly choice: "COD" | "ONLINE";
  readonly label: string;
  readonly detail: string;
}

/**
 * What a customer may choose at checkout.
 *
 * Cash (pay on collection, or at the door) is offered — subject to the COD
 * cap in `./cod` when online payment exists — unless the business has
 * switched it off. Online appears only when Razorpay has keys *and* the
 * business has switched it on: `isRazorpayConfigured()` says the gateway
 * *can* take a payment, `toggles.online` says the business wants it to right
 * now (roadmap 5.5's restaurant settings toggle) — two different questions,
 * both have to say yes. A list, not a constant, so checkout renders whatever
 * is here without knowing how each one works.
 *
 * `toggles` defaults to both on, which is every existing caller's behaviour
 * before the settings toggle existed — a caller with no org context (a test)
 * gets exactly what it got before.
 */
export function availableMethods(toggles?: { cash?: boolean; online?: boolean }): readonly CheckoutMethod[] {
  const cashEnabled = toggles?.cash ?? true;
  const onlineEnabled = toggles?.online ?? true;

  const methods: CheckoutMethod[] = [];
  if (cashEnabled) {
    methods.push({
      method: "CASH",
      provider: CASH_PROVIDER,
      choice: "COD",
      label: "Pay on collection",
      detail: "Cash, UPI or card at the counter, or at the door.",
    });
  }
  if (onlineEnabled && isRazorpayConfigured()) {
    methods.unshift({
      method: "UPI",
      provider: RAZORPAY_PROVIDER,
      choice: "ONLINE",
      label: "Pay now",
      detail: "UPI, card, net banking or wallet.",
    });
  }
  return methods;
}

export { CASH_PROVIDER, cashProvider };
export { RAZORPAY_PROVIDER, isRazorpayConfigured, razorpayConfig } from "./razorpay";
export { COD_CAP, codAllowed } from "./cod";
export * from "./provider";
