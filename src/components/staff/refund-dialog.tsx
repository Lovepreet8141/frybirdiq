"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { refundPaymentAction } from "@/lib/finance/actions";
import { type Paise, formatAmount, formatINR } from "@/lib/money";

/**
 * Refund one payment. Roadmap 1.4.
 *
 * The amount defaults to everything that is left and cannot be typed above
 * it — but the server checks again, because a dialog is not authorization.
 * The reason is required: a refund with no reason is the one a manager
 * cannot explain a month later.
 */
export function RefundDialog({
  open,
  onOpenChange,
  payment,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  payment: { id: string; orderNumber: string; amount: Paise; refunded: Paise; provider: string; method: string } | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [amount, setAmount] = useState<string>("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  // One key per refund attempt. A retried submit (a slow network, a second
  // click that beat `pending`) reuses it, so the server replays the first
  // result instead of refunding twice; closing the dialog — cancelled or
  // completed — rotates it, so the next attempt is a genuinely new one.
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());

  const remaining = payment ? ((payment.amount - payment.refunded) as Paise) : (0n as Paise);
  const remainingRupees = payment ? formatAmount(remaining) : "0";

  function reset() {
    setAmount("");
    setReason("");
    setError(null);
    setDone(null);
    setIdempotencyKey(crypto.randomUUID());
  }

  function submit() {
    if (!payment) return;
    setError(null);
    startTransition(async () => {
      const result = await refundPaymentAction({ paymentId: payment.id, amount: amount.trim() === "" ? remainingRupees : amount.trim(), reason, idempotencyKey });
      if (result.ok) {
        setDone(`Refunded. ${payment.provider === "razorpay" ? "Razorpay has been told; the customer sees it in a few days." : "Hand the cash over now."}`);
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Refund #{payment?.orderNumber}</DialogTitle>
          <DialogDescription>
            {payment ? `${formatINR(remaining)} of ${formatINR(payment.amount)} can still go back${payment.provider === "razorpay" ? " through Razorpay" : " in cash"}.` : ""}
          </DialogDescription>
        </DialogHeader>

        {done ? (
          <p role="status" className="rounded-md border-l-2 border-gain bg-gain-soft/60 px-4 py-3 text-sm">
            {done}
          </p>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="grid gap-1.5">
              <Label htmlFor="refund-amount" className="text-[13px] font-semibold">
                Amount (₹)
              </Label>
              <Input id="refund-amount" inputMode="decimal" placeholder={remainingRupees} value={amount} onChange={(event) => setAmount(event.target.value)} className="tabular" />
              <p className="text-[12.5px] text-muted-foreground">Leave empty to refund everything that is left.</p>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="refund-reason" className="text-[13px] font-semibold">
                Reason
              </Label>
              <Input id="refund-reason" maxLength={200} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Wrong order delivered" />
            </div>
            {error && (
              <p role="alert" className="rounded-md border-l-2 border-loss bg-loss-soft/60 px-4 py-3 text-sm">
                {error}
              </p>
            )}
          </div>
        )}

        <DialogFooter>
          {done ? (
            <Button variant="inverse" onClick={() => onOpenChange(false)}>
              Done
            </Button>
          ) : (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
                Cancel
              </Button>
              <Button variant="destructive" onClick={submit} disabled={pending || reason.trim().length < 3}>
                {pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
                {pending ? "Refunding" : `Refund ${amount.trim() === "" ? formatINR(remaining) : `₹${amount.trim()}`}`}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
