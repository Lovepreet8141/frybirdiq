"use client";

import { useState, useTransition } from "react";
import { Loader2, MessageCircle } from "lucide-react";
import { whatsappOrderLink } from "@/lib/notifications/actions";

/**
 * Opens WhatsApp with the order details already written.
 *
 * Says "Send on WhatsApp", not "Sent" — a person still presses send in the app.
 * §57: never make something look like it happened when it has not.
 */
export function WhatsAppButton({ orderId, phone }: { orderId: string; phone: string | null }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (!phone) return null;

  const open = () =>
    startTransition(async () => {
      setError(null);
      const result = await whatsappOrderLink({ orderId });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      // Opened rather than navigated, so the invoice stays put behind it.
      window.open(result.url, "_blank", "noopener,noreferrer");
    });

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={open}
        disabled={pending}
        className="inline-flex min-h-[44px] items-center gap-2 rounded-md border border-border-strong px-4 text-sm font-semibold transition-colors hover:bg-surface disabled:opacity-50"
      >
        {pending ? (
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        ) : (
          <MessageCircle className="size-4" aria-hidden="true" />
        )}
        Send on WhatsApp
      </button>
      {error && (
        <p role="alert" className="text-sm text-muted-foreground">
          {error}
        </p>
      )}
    </div>
  );
}
