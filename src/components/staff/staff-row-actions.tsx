"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { changeStaffRoleAction, deactivateStaffAction } from "@/lib/staff/actions";
import type { Role } from "@/domain/permissions";

const selectClass =
  "h-8 min-w-0 rounded-md border border-input bg-panel px-2 text-[13px] text-foreground transition-[border-color,box-shadow] duration-[120ms] outline-none focus-visible:border-primary focus-visible:ring-[3px] focus-visible:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-60";

/**
 * Change role / deactivate, for one row of the roster. Roadmap 6.1.
 *
 * `grantableRoles` is this signed-in account's own `canGrantRole` ceiling,
 * resolved once by the page and threaded down — the same list the invite
 * form uses. A row only renders these controls at all when every role the
 * target currently holds is inside that same list (computed by
 * `StaffTable`): never on the actor's own row, never on someone whose role
 * can do more than the actor's own can. The server re-checks all of this
 * regardless — see `lib/staff/actions.ts` — this only keeps the UI honest
 * about what will actually be allowed.
 */
export function StaffRowActions({ userId, roles, grantableRoles }: { userId: string; roles: readonly Role[]; grantableRoles: readonly Role[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [role, setRole] = useState<Role>(roles[0] ?? grantableRoles[0] ?? "CASHIER");
  const [error, setError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  function submitRoleChange(next: Role) {
    const previous = role;
    setRole(next);
    setError(null);
    startTransition(async () => {
      const result = await changeStaffRoleAction({ userId, role: next });
      if (result.ok) {
        router.refresh();
      } else {
        setRole(previous);
        setError(result.error);
      }
    });
  }

  function submitDeactivate() {
    setError(null);
    startTransition(async () => {
      const result = await deactivateStaffAction(userId);
      if (result.ok) {
        setConfirmOpen(false);
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-2">
        <select
          aria-label="Change role"
          value={role}
          onChange={(event) => submitRoleChange(event.target.value as Role)}
          disabled={pending}
          className={selectClass}
          title={roles.length > 1 ? "This person holds more than one role. Choosing one here replaces all of them with just that one." : undefined}
        >
          {grantableRoles.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
        <Button type="button" variant="outline" size="sm" onClick={() => setConfirmOpen(true)} disabled={pending}>
          Deactivate
        </Button>
      </div>
      {error && (
        <p role="alert" className="max-w-56 text-right text-[12px] text-loss">
          {error}
        </p>
      )}

      <Dialog open={confirmOpen} onOpenChange={(next) => !pending && setConfirmOpen(next)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Deactivate this account?</DialogTitle>
            <DialogDescription>
              They lose access immediately. The account and its order history stay on record — nothing is deleted, and an owner can bring them back with{" "}
              <code className="rounded bg-surface-muted px-1 py-0.5 text-[12px]">pnpm staff:grant</code>.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setConfirmOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button type="button" variant="destructive" onClick={submitDeactivate} disabled={pending}>
              {pending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
              {pending ? "Deactivating" : "Deactivate"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
