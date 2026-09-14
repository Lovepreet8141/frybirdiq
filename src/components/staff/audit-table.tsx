"use client";

import { useMemo, useState } from "react";
import { ListFilter, Search } from "lucide-react";
import { DataTable, dataColumns } from "@/components/iq/data-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { EmptyState } from "@/components/states";

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
  return new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}

/** "payment_captured" -> "Payment captured". Cosmetic only — the stored action string is never rewritten. */
function humanize(action: string): string {
  return action.replaceAll("_", " ").replace(/^./, (char) => char.toUpperCase());
}

const column = dataColumns<AuditRow>();

/**
 * The audit trail on the shared `DataTable` — search, an entity/actor
 * filter menu (the purchased `tables10` pattern), sortable time. A row
 * opens a Sheet with the raw before/after JSON: a diff view that
 * reformatted these values would risk showing something other than what
 * was recorded.
 */
export function AuditTable({ entries }: { entries: readonly AuditRow[] }) {
  const [search, setSearch] = useState("");
  const [entities, setEntities] = useState<ReadonlySet<string>>(new Set());
  const [actors, setActors] = useState<ReadonlySet<string>>(new Set());
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const entityOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const entry of entries) counts.set(entry.entity, (counts.get(entry.entity) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [entries]);
  const actorOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const entry of entries) counts.set(entry.actorName ?? "System", (counts.get(entry.actorName ?? "System") ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [entries]);

  const normalised = search.trim().toLowerCase();
  const rows = useMemo(
    () =>
      entries.filter((entry) => {
        if (entities.size > 0 && !entities.has(entry.entity)) return false;
        if (actors.size > 0 && !actors.has(entry.actorName ?? "System")) return false;
        if (normalised === "") return true;
        return entry.action.toLowerCase().includes(normalised) || entry.entity.toLowerCase().includes(normalised) || (entry.actorName ?? "").toLowerCase().includes(normalised) || (entry.entityId ?? "").toLowerCase().includes(normalised);
      }),
    [entries, entities, actors, normalised],
  );

  const columns = useMemo(
    () =>
      column.columns([
        column.accessor((row) => row.action, {
          id: "action",
          header: "Action",
          cell: ({ row }) => (
            <div className="flex flex-col gap-0.5">
              <span className="font-semibold">{humanize(row.original.action)}</span>
              {row.original.entityId && <span className="truncate font-mono text-[11px] text-muted-foreground">{row.original.entityId}</span>}
            </div>
          ),
        }),
        column.accessor((row) => row.entity, { id: "entity", header: "Entity", enableSorting: false, cell: ({ row }) => <Badge variant="outline">{row.original.entity}</Badge> }),
        column.accessor((row) => row.actorName ?? "System", { id: "by", header: "By", meta: { className: "hidden sm:table-cell" }, cell: ({ row }) => <span className="text-muted-foreground">{row.original.actorName ?? "System"}</span> }),
        column.accessor((row) => new Date(row.createdAt).getTime(), { id: "at", header: "When", meta: { align: "right" }, cell: ({ row }) => <span className="tabular text-muted-foreground">{formatWhen(row.original.createdAt)}</span> }),
      ]),
    [],
  );

  const selected = selectedId ? (entries.find((entry) => entry.id === selectedId) ?? null) : null;
  const activeFilters = entities.size + actors.size;
  const toggle = (set: ReadonlySet<string>, key: string): ReadonlySet<string> => {
    const next = new Set(set);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return next;
  };

  if (entries.length === 0) {
    return <EmptyState title="No audit events recorded yet" detail="Sensitive actions — payments captured, refunds, price changes, staff changes — appear here as they happen." />;
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Action, entity, staff or id" aria-label="Search audit log" className="h-9 pl-8" />
        </div>
        <div className="ml-auto">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline">
                <ListFilter data-icon="inline-start" aria-hidden="true" />
                Filter
                {activeFilters > 0 && <span className="tabular flex size-5 items-center justify-center rounded-full bg-inverse text-[11px] font-semibold text-inverse-foreground">{activeFilters}</span>}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel>Entity</DropdownMenuLabel>
              {entityOptions.map(([entity, count]) => (
                <DropdownMenuCheckboxItem key={entity} checked={entities.has(entity)} onCheckedChange={() => setEntities((current) => toggle(current, entity))}>
                  {entity} <span className="tabular ml-auto text-xs text-muted-foreground">{count}</span>
                </DropdownMenuCheckboxItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuLabel>By</DropdownMenuLabel>
              {actorOptions.map(([actor, count]) => (
                <DropdownMenuCheckboxItem key={actor} checked={actors.has(actor)} onCheckedChange={() => setActors((current) => toggle(current, actor))}>
                  {actor} <span className="tabular ml-auto text-xs text-muted-foreground">{count}</span>
                </DropdownMenuCheckboxItem>
              ))}
              {activeFilters > 0 && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={() => {
                      setEntities(new Set());
                      setActors(new Set());
                    }}
                  >
                    Clear filters
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <DataTable
        columns={columns}
        data={rows}
        rowKey={(row) => row.id}
        initialSorting={[{ id: "at", desc: true }]}
        noun="events"
        totalCount={entries.length}
        onRowClick={(row) => setSelectedId(row.id)}
        empty={
          <>
            <p>No events match{normalised ? ` “${search.trim()}”` : ""}.</p>
            <Button
              variant="link"
              className="mt-1 h-auto p-0 text-[13px]"
              onClick={() => {
                setSearch("");
                setEntities(new Set());
                setActors(new Set());
              }}
            >
              Clear search and filters
            </Button>
          </>
        }
      />

      <Sheet open={selected !== null} onOpenChange={(open) => !open && setSelectedId(null)}>
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md">
          <SheetHeader>
            <SheetTitle>{selected ? humanize(selected.action) : "Event"}</SheetTitle>
            {selected && (
              <SheetDescription>
                {selected.entity} · {selected.actorName ?? "System"} · {formatWhen(selected.createdAt)}
              </SheetDescription>
            )}
          </SheetHeader>
          {selected && (
            <div className="flex flex-col gap-4 px-4 pb-4 text-sm">
              {selected.entityId && (
                <dl className="flex justify-between gap-4">
                  <dt className="text-muted-foreground">Entity ID</dt>
                  <dd className="tabular truncate font-mono text-xs">{selected.entityId}</dd>
                </dl>
              )}
              {selected.before && (
                <div className="flex flex-col gap-1.5">
                  <p className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">Before</p>
                  <pre className="overflow-x-auto rounded-md bg-surface-muted p-3 font-mono text-xs">{JSON.stringify(selected.before, null, 2)}</pre>
                </div>
              )}
              {selected.after && (
                <div className="flex flex-col gap-1.5">
                  <p className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">After</p>
                  <pre className="overflow-x-auto rounded-md bg-surface-muted p-3 font-mono text-xs">{JSON.stringify(selected.after, null, 2)}</pre>
                </div>
              )}
              {!selected.before && !selected.after && <p className="text-muted-foreground">This event recorded no before/after snapshot.</p>}
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
