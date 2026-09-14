"use client";

import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export interface AuditRow {
  readonly id: string;
  readonly action: string;
  readonly entity: string;
  readonly entityId: string | null;
  readonly actorName: string | null;
  readonly before: Record<string, unknown> | null;
  readonly after: Record<string, unknown> | null;
  readonly createdAt: string;
}

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" });
}

/** "payment_captured" -> "Payment captured". Cosmetic only — the stored action string is never rewritten. */
function humanize(action: string): string {
  return action.replaceAll("_", " ").replace(/^./, (char) => char.toUpperCase());
}

/**
 * The audit trail — read-only, same search-over-fetched-rows pattern as
 * every other workspace table this session. A row opens a Sheet with the
 * raw before/after JSON, since a diff view that reformats these values
 * risks showing something other than what was actually recorded.
 */
export function AuditTable({ entries }: { entries: readonly AuditRow[] }) {
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const normalised = search.trim().toLowerCase();

  const filtered = useMemo(() => {
    if (normalised === "") return entries;
    return entries.filter(
      (entry) =>
        entry.action.toLowerCase().includes(normalised) ||
        entry.entity.toLowerCase().includes(normalised) ||
        (entry.actorName ?? "").toLowerCase().includes(normalised),
    );
  }, [entries, normalised]);

  const selected = selectedId ? (entries.find((entry) => entry.id === selectedId) ?? null) : null;

  return (
    <div className="flex flex-col gap-4">
      <div className="relative w-full max-w-xs">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search action, entity or staff"
          aria-label="Search audit log"
          className="h-9 pl-8"
        />
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-panel">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Action</TableHead>
              <TableHead>Entity</TableHead>
              <TableHead>By</TableHead>
              <TableHead className="text-right">When</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="h-24 whitespace-normal text-center text-muted-foreground">
                  {entries.length === 0
                    ? "No audit events recorded yet. Sensitive actions will appear here as they happen."
                    : "No events match that search."}
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((entry) => (
                <TableRow key={entry.id} onClick={() => setSelectedId(entry.id)} className="cursor-pointer">
                  <TableCell className="font-semibold">{humanize(entry.action)}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{entry.entity}</Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{entry.actorName ?? "System"}</TableCell>
                  <TableCell className="tabular text-right text-muted-foreground">{formatWhen(entry.createdAt)}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <Sheet open={selected !== null} onOpenChange={(open) => !open && setSelectedId(null)}>
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md">
          <SheetHeader>
            <SheetTitle>{selected ? humanize(selected.action) : "Event"}</SheetTitle>
          </SheetHeader>
          {selected && (
            <div className="flex flex-col gap-4 px-4 pb-4 text-sm">
              <dl className="flex flex-col gap-1.5">
                <div className="flex justify-between gap-4">
                  <dt className="text-muted-foreground">Entity</dt>
                  <dd className="font-medium">{selected.entity}</dd>
                </div>
                {selected.entityId && (
                  <div className="flex justify-between gap-4">
                    <dt className="text-muted-foreground">Entity ID</dt>
                    <dd className="tabular truncate font-mono text-xs">{selected.entityId}</dd>
                  </div>
                )}
                <div className="flex justify-between gap-4">
                  <dt className="text-muted-foreground">By</dt>
                  <dd className="font-medium">{selected.actorName ?? "System"}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-muted-foreground">When</dt>
                  <dd className="tabular font-medium">{formatWhen(selected.createdAt)}</dd>
                </div>
              </dl>

              {selected.before && (
                <div className="flex flex-col gap-1.5">
                  <p className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">Before</p>
                  <pre className="overflow-x-auto rounded-md bg-surface-muted p-3 font-mono text-xs">
                    {JSON.stringify(selected.before, null, 2)}
                  </pre>
                </div>
              )}

              {selected.after && (
                <div className="flex flex-col gap-1.5">
                  <p className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">After</p>
                  <pre className="overflow-x-auto rounded-md bg-surface-muted p-3 font-mono text-xs">
                    {JSON.stringify(selected.after, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
