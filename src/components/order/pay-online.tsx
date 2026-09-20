"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Script from "next/script";
import { Loader2, RotateCcw, ShieldCheck } from "lucide-react";
import { confirmOnlinePaymentAction, reportOnlinePaymentFailureAction } from "@/lib/payments/actions";

interface RazorpaySuccess {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
}

interface RazorpayInstance {
  open: () => void;
  on: (event: "payment.failed", handler: (response: { error?: { description?: string } }) => void) => void;
}

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => RazorpayInstance;
  }
}

type Phase = "loading" | "ready" | "open" | "confirming" | "done" | "dismissed" | "failed" | "error" | "checking";

/**
 * Razorpay Checkout on the order page. Roadmap 1.2 / 1.5.
 *
 * The browser only ever learns the public key id, the Razorpay order id and
 * the amount the server already fixed; the handler posts Razorpay's ids and
 * signature back and the server decides whether money actually moved.
 * Closing the sheet leaves the order waiting with a "Pay now" button —
 * never a phantom paid order, never a lost one.
 */
export function PayOnline({
  orderId,
  orderNumber,
  keyId,
  providerOrderId,
  amountPaise,
  amountLabel,
  prefill,
  autoOpen,
  failureReason,
}: {
  orderId: string;
  orderNumber: string;
  keyId: string;
  providerOrderId: string;
  /** Integer paise, as Razorpay wants it. Display uses `amountLabel`. */
  amountPaise: number;
  amountLabel: string;
  prefill: { name: string | null; email: string | null; contact: string | null };
  /** True straight after checkout, so the sheet opens without a second tap. */
  autoOpen: boolean;
  failureReason: string | null;
}) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("loading");
  const [message, setMessage] = useState<string | null>(failureReason);
  const opened = useRef(false);

  const open = useCallback(() => {
    const Razorpay = window.Razorpay;
    if (!Razorpay) {
      setPhase("error");
      setMessage("The payment window could not load. Check your connection and try again.");
      return;
    }
    setPhase("open");
    const instance = new Razorpay({
      key: keyId,
      amount: amountPaise,
      currency: "INR",
      name: "FRYBIRD",
      description: `Order #${orderNumber}`,
      order_id: providerOrderId,
      prefill: { name: prefill.name ?? undefined, email: prefill.email ?? undefined, contact: prefill.contact ?? undefined },
      theme: { color: "#d92b2b" },
      retry: { enabled: true, max_count: 3 },
      modal: {
        ondismiss: () => {
          setPhase((current) => (current === "confirming" || current === "done" ? current : "dismissed"));
        },
      },
      handler: async (response: RazorpaySuccess) => {
        setPhase("confirming");
        const result = await confirmOnlinePaymentAction({
          orderId,
          razorpayOrderId: response.razorpay_order_id,
          razorpayPaymentId: response.razorpay_payment_id,
          razorpaySignature: response.razorpay_signature,
        });
        if (result.ok) {
          setPhase("done");
          router.refresh();
        } else if (result.code === "GATEWAY_UNAVAILABLE") {
          // The money may already be in flight: say we are checking, offer NO second payment, only a refresh.
          setPhase("checking");
          setMessage(result.error);
        } else {
          setPhase("error");
          setMessage(result.error);
        }
      },
    });
    instance.on("payment.failed", (response) => {
      const description = response.error?.description ?? "Payment failed";
      setMessage(description);
      setPhase("failed");
      void reportOnlinePaymentFailureAction({ orderId, reason: description });
    });
    instance.open();
  }, [amountPaise, keyId, orderId, orderNumber, prefill, providerOrderId, router]);

  useEffect(() => {
    if (phase === "ready" && autoOpen && !opened.current) {
      opened.current = true;
      open();
    }
  }, [autoOpen, open, phase]);

  const busy = phase === "loading" || phase === "open" || phase === "confirming";

  return (
    <div className="mt-6 flex flex-col gap-3 rounded-lg border-[2.5px] border-[var(--ink)] bg-[var(--cream-hi)] p-5 shadow-[6px_6px_0_var(--red)]">
      <Script src="https://checkout.razorpay.com/v1/checkout.js" strategy="afterInteractive" onLoad={() => setPhase((current) => (current === "loading" ? "ready" : current))} onError={() => setPhase("error")} />

      {phase === "done" ? (
        <p className="flex items-center gap-2 font-semibold">
          <ShieldCheck className="size-5 text-[#3F9D52]" aria-hidden="true" />
          Payment received. Updating your order…
        </p>
      ) : phase === "checking" ? (
        <>
          <p className="font-heading text-lg font-semibold">Checking your payment</p>
          <p role="status" className="mt-1 text-sm text-muted-foreground">
            {message}
          </p>
          <button
            type="button"
            onClick={() => router.refresh()}
            className="flex min-h-[56px] w-full items-center justify-center gap-2 rounded-md border border-border bg-panel px-6 text-base font-semibold hover:bg-surface"
          >
            <RotateCcw className="size-4" aria-hidden="true" />
            Check again
          </button>
        </>
      ) : (
        <>
          <div>
            <p className="font-heading text-lg font-semibold">
              {phase === "dismissed" || phase === "failed" || phase === "error" ? "Payment not completed" : "Pay to confirm your order"}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {phase === "dismissed"
                ? "Your order is saved. Pay now and the kitchen gets it straight away."
                : phase === "failed" || phase === "error"
                  ? (message ?? "Something went wrong with the payment.")
                  : "UPI, card, net banking or wallet. Nothing is charged until you confirm in the payment window."}
            </p>
          </div>

          {message && phase !== "failed" && phase !== "error" && phase !== "dismissed" && (
            <p role="status" className="rounded-md border border-border bg-surface px-3 py-2 text-sm">
              Last attempt: {message}. You can try again.
            </p>
          )}

          <button
            type="button"
            onClick={open}
            disabled={busy}
            className="flex min-h-[56px] w-full items-center justify-center gap-2 rounded-md bg-primary px-6 text-base font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
          >
            {phase === "confirming" ? (
              <>
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                Confirming payment
              </>
            ) : phase === "loading" || phase === "open" ? (
              <>
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                {phase === "open" ? "Payment window open" : "Loading payment"}
              </>
            ) : phase === "dismissed" || phase === "failed" || phase === "error" ? (
              <>
                <RotateCcw className="size-4" aria-hidden="true" />
                Retry payment · {amountLabel}
              </>
            ) : (
              <>Pay {amountLabel} now</>
            )}
          </button>
        </>
      )}
    </div>
  );
}
