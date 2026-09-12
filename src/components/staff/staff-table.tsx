"use client";

import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
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
 * The staff roster. Read-only: no invite, no edit, no role change here — see
 * `staff.ts`'s module comment for why. Search is client-side over the same
 * pattern `OrdersTable`/`CustomersTable` already established.
 */
export function StaffTable({ staff }: { staff: readonly StaffRow[] }) {
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

      <div className="overflow-hidden rounded-lg border border-border bg-surface">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Joined</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="h-24 whitespace-normal text-center text-muted-foreground">
                  {staff.length === 0 ? "No staff accounts yet." : "No staff match that search."}
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((member) => (
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
                    <Badge variant={member.isActive ? "secondary" : "destructive"}>{member.isActive ? "Active" : "Inactive"}</Badge>
                  </TableCell>
                  <TableCell className="tabular text-right text-muted-foreground">{formatDate(member.joinedAt)}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
