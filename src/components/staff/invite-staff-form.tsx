"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Panel, PanelBody, PanelHeader } from "@/components/iq/ui";
import { inviteStaffAction } from "@/lib/staff/actions";
import type { Role } from "@/domain/permissions";

const selectClass =
  "h-10 w-full min-w-0 rounded-md border border-input bg-panel px-3 text-sm text-foreground transition-[border-color,box-shadow] duration-[120ms] outline-none focus-visible:border-primary focus-visible:ring-[3px] focus-visible:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-60";

/**
 * Invite by email + role. Roadmap 6.1.
 *
 * `roles` is only the roles this signed-in account can actually grant —
 * `canGrantRole`, resolved server-side by the page — so the dropdown can
 * never offer something the server would refuse anyway. That is a courtesy,
 * not the guard: `inviteStaffAction` re-checks it, because a hidden option
 * is not authorization any more than a hidden button is (§41).
 */
export function InviteStaffForm({ roles }: { roles: readonly Role[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>(roles[0] ?? "CASHIER");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  if (roles.length === 0) {
    // Nobody without at least one grantable role reaches this screen — every
    // holder of `staff.manage` is OWNER or ADMIN, and OWNER grants everything
    // — but the form still needs an honest state rather than a broken one.
    return (
      <Panel>
        <PanelHeader title="Invite staff" />
        <PanelBody>
          <p className="text-[13px] text-muted-foreground">Your account can&rsquo;t grant any role right now.</p>
        </PanelBody>
      </Panel>
    );
  }

  function submit() {
    setError(null);
    setSuccess(null);
    startTransition(async () => {
      const result = await inviteStaffAction({ email: email.trim(), role });
      if (result.ok) {
        setSuccess(result.message);
        setEmail("");
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <Panel>
      <PanelHeader title="Invite staff" description="They'll get an email to set a password. Access starts the moment they accept." />
      <PanelBody>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
          <div className="flex-1 grid gap-1.5">
            <Label htmlFor="invite-email" className="text-[13px] font-semibold">
              Email
            </Label>
            <Input
              id="invite-email"
              type="email"
              inputMode="email"
              autoComplete="off"
              placeholder="name@example.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              disabled={pending}
            />
          </div>
          <div className="grid gap-1.5 sm:w-40">
            <Label htmlFor="invite-role" className="text-[13px] font-semibold">
              Role
            </Label>
            <select id="invite-role" value={role} onChange={(event) => setRole(event.target.value as Role)} className={selectClass} disabled={pending}>
              {roles.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </div>
          <Button onClick={submit} disabled={pending || email.trim() === ""} className="sm:w-32">
            {pending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Mail className="size-4" aria-hidden="true" />}
            {pending ? "Sending" : "Invite"}
          </Button>
        </div>

        {success && (
          <p role="status" className="mt-3 rounded-md border-l-2 border-gain bg-gain-soft/60 px-4 py-3 text-sm">
            {success}
          </p>
        )}
        {error && (
          <p role="alert" className="mt-3 rounded-md border-l-2 border-loss bg-loss-soft/60 px-4 py-3 text-sm">
            {error}
          </p>
        )}
      </PanelBody>
    </Panel>
  );
}
