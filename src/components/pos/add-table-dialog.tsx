"use client";

import { useState, useTransition } from "react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ReloadAppButton } from "@/components/reload-app-button";
import { createTableAction, type ActionResult } from "@/lib/pos/table-actions";
import { STALE_DEPLOYMENT_MESSAGE, recoverFromStaleDeployment } from "@/lib/errors/stale-deployment";

const IDLE: ActionResult = { ok: true };

/**
 * Floor-plan change — `settings.manage`, same gate the action itself
 * re-checks. Calls the action directly inside a transition (rather than
 * `useActionState`) so a success can close the dialog as a direct response
 * to the submit, not from an effect reacting to a state change afterwards.
 */
export function AddTableDialog() {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<ActionResult>(IDLE);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startTransition(async () => {
      const result = await recoverFromStaleDeployment(() => createTableAction(IDLE, formData));
      setState(result);
      if (result.ok) setOpen(false);
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setState(IDLE);
      }}
    >
      <DialogTrigger asChild>
        <Button variant="secondary">Add table</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a table</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          {!state.ok && state.error && (
            <div role="alert" className="flex flex-col items-start gap-2 text-sm text-[var(--destructive)]">
              {state.error}
              {state.error === STALE_DEPLOYMENT_MESSAGE && <ReloadAppButton />}
            </div>
          )}

          <label className="flex flex-col gap-1 text-sm font-semibold">
            Name
            <input
              name="name"
              required
              placeholder="Table 4"
              className="min-h-[40px] rounded-md border border-border bg-surface px-3 font-normal"
            />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 text-sm font-semibold">
              Category
              <input
                name="category"
                placeholder="Patio, Indoor…"
                className="min-h-[40px] rounded-md border border-border bg-surface px-3 font-normal"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm font-semibold">
              Seats
              <input
                name="capacity"
                type="number"
                min={1}
                step={1}
                placeholder="4"
                className="min-h-[40px] rounded-md border border-border bg-surface px-3 font-normal"
              />
            </label>
          </div>

          <DialogFooter>
            <Button type="submit" disabled={isPending}>
              {isPending ? "Adding…" : "Add table"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
