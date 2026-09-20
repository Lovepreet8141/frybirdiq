"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { assignRiderAction, failDeliveryAction } from "@/lib/auth/staff-actions";

export interface RiderOption {
  readonly userId: string;
  readonly displayName: string | null;
}

const riderLabel = (rider: RiderOption) => rider.displayName ?? "Rider";

/**
 * Who carries this delivery (roadmap 6.3). Shown to people who may assign
 * (`delivery.assign`); the server re-checks. "Unassigned" is a real state: an
 * unassigned delivery is on no rider's list.
 */
export function AssignRiderControl({ orderId, riderUserId, riders }: { orderId: string; riderUserId: string | null; riders: readonly RiderOption[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const current = riders.find((rider) => rider.userId === riderUserId);

  const assign = (nextId: string) => {
    if (nextId === "" || nextId === riderUserId) return;
    setMessage(null);
    startTransition(async () => {
      try {
        const result = await assignRiderAction({ orderId, riderUserId: nextId });
        if (!result.ok) setMessage(result.error ?? "That did not work. Try again.");
        else router.refresh();
      } catch {
        setMessage("No connection. Try again.");
      }
    });
  };

  return (
    <div className="flex flex-col gap-1">
      <label className="flex items-center gap-2 text-sm">
        <UserRound className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="text-muted-foreground">Rider</span>
        <select
          aria-label="Assign a rider"
          value={riderUserId ?? ""}
          disabled={pending || riders.length === 0}
          onChange={(event) => assign(event.target.value)}
          className="min-h-9 rounded-md border border-border bg-panel px-2 text-sm"
        >
          <option value="">{riders.length === 0 ? "No active riders" : "Unassigned"}</option>
          {riders.map((rider) => (
            <option key={rider.userId} value={rider.userId}>
              {riderLabel(rider)}
            </option>
          ))}
          {riderUserId && !current && <option value={riderUserId}>Former rider</option>}
        </select>
        {pending && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
      </label>
      {message && (
        <p role="alert" className="text-sm text-loss">
          {message}
        </p>
      )}
    </div>
  );
}

/**
 * "Couldn't deliver": a reason, then the order is recorded FAILED. Two steps on
 * purpose (open, then confirm) so it cannot be tapped by accident at the door.
 */
export function FailDeliveryControl({ orderId }: { orderId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const submit = () => {
    setMessage(null);
    startTransition(async () => {
      try {
        const result = await failDeliveryAction({ orderId, reason });
        if (!result.ok) setMessage(result.error ?? "That did not work. Try again.");
        else router.refresh();
      } catch {
        setMessage("No connection. Try again.");
      }
    });
  };

  if (!open) {
    return (
      <Button type="button" variant="outline" size="lg" className="min-h-12 text-base" onClick={() => setOpen(true)}>
        Couldn’t deliver
      </Button>
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-surface-muted p-3">
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-semibold">Why couldn’t it be delivered?</span>
        <textarea
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          maxLength={200}
          rows={2}
          className="rounded-md border border-border bg-panel p-2 text-base"
          placeholder="For example: customer not answering, wrong address"
        />
      </label>
      {message && (
        <p role="alert" className="text-sm text-loss">
          {message}
        </p>
      )}
      <div className="flex gap-2">
        <Button type="button" variant="destructive" disabled={pending || reason.trim().length < 3} aria-busy={pending} onClick={submit} className="min-h-12 flex-1 gap-2 text-base">
          {pending && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
          Record as not delivered
        </Button>
        <Button type="button" variant="ghost" disabled={pending} onClick={() => setOpen(false)} className="min-h-12">
          Back
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">The shop is told. A paid order needs a manager to refund it.</p>
    </div>
  );
}
