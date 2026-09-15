"use client";

import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StaffRowActions } from "@/components/staff/staff-row-actions";
import type { Role } from "@/domain/permissions";

export interface StaffRow {
  readonly userId: string;
  readonly displayName: string | null;
  readonly roles: readonly Role[];
  readonly isActive: boolean;
  readonly joinedAt: string;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric" });
}

/**
 * The staff roster, with role-change and deactivate on every row this
 * signed-in account is allowed to touch. Search is client-side over the same
 * pattern `OrdersTable`/`CustomersTable` already established.
 *
 * `actorUserId` and `grantableRoles` (this account's `canGrantRole` ceiling)
 * decide, row by row, whether `StaffRowActions` renders at all: never on the
 * actor's own row, never on someone holding a role that can do more than the
 * actor's own roles can. `grantableRoles` empty means the whole roster is
 * read-only for this viewer — `staff.manage` without a usable ceiling, which
 * should not happen since only OWNER and ADMIN hold it, but the table stays
 * honest either way rather than assuming.
 */
export function StaffTable({ staff, actorUserId, grantableRoles }: { staff: readonly StaffRow[]; actorUserId: string; grantableRoles: readonly Role[] }) {
  const [search, setSearch] = useState("");
  const normalised = search.trim().toLowerCase();

  const filtered = useMemo(() => {
    if (normalised === "") return staff;
    return staff.filter(
      (member) =>
        (member.displayName ?? "").toLowerCase().includes(normalised) ||
        member.roles.some((role) => role.toLowerCase().includes(normalised)),
    );
  }, [staff, normalised]);

  return (
    <div className="flex flex-col gap-4">
      <div className="relative w-full max-w-xs">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search name or role"
          aria-label="Search staff"
          className="h-9 pl-8"
        />
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-panel">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Joined</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="h-24 whitespace-normal text-center text-muted-foreground">
                  {staff.length === 0 ? "No staff accounts yet." : "No staff match that search."}
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((member) => {
                // Never the actor's own row, never a row holding a role more
                // powerful than the actor's own — `grantableRoles` already is
                // that ceiling, so membership in it is enough to check here.
                const canManageRow = member.isActive && member.userId !== actorUserId && member.roles.every((role) => grantableRoles.includes(role));
                return (
                  <TableRow key={member.userId}>
                    <TableCell className="font-semibold">{member.displayName ?? "Unnamed"}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {member.roles.map((role) => (
                          <Badge key={role} variant="outline">
                            {role}
                          </Badge>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={member.isActive ? "success" : "destructive"}>{member.isActive ? "Active" : "Inactive"}</Badge>
                    </TableCell>
                    <TableCell className="tabular text-muted-foreground">{formatDate(member.joinedAt)}</TableCell>
                    <TableCell className="text-right">
                      {canManageRow ? (
                        <StaffRowActions userId={member.userId} roles={member.roles} grantableRoles={grantableRoles} />
                      ) : (
                        <span className="text-[12.5px] text-muted-foreground">{member.userId === actorUserId ? "You" : "—"}</span>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
