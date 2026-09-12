"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { type Paise, formatINR } from "@/lib/money";
import { cn } from "@/lib/utils";

export interface CustomerRow {
  readonly id: string;
  readonly name: string | null;
  readonly phone: string | null;
  readonly orderCount: number;
  readonly totalSpend: Paise;
  readonly lastOrderAt: string | null;
  readonly stampCount: number;
}

function formatDate(iso: string | null): string {
  if (!iso) return "Never";
  return new Date(iso).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric" });
}

/**
 * The customer list — searchable client-side over everything the page
 * already fetched, same pattern as `OrdersTable`. "Orders" and "Total spent"
 * count only paid sales (`getCustomerProfile`'s definition), so this can
 * never disagree with the dashboard about what counts as a sale.
 */
type Segment = "all" | "recent" | "lapsed" | "never" | "regulars";

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Segments are facts about the rows already on screen, nothing more: when
 * the last paid order was, and how many there have been. No model, no
 * "likely to churn" — a lapsed customer is one who has not ordered in 30
 * days, said in exactly those words.
 */
const SEGMENTS: readonly { key: Segment; label: string; description: string; matches: (customer: CustomerRow, now: number) => boolean }[] = [
  { key: "all", label: "All", description: "Everyone", matches: () => true },
  {
    key: "recent",
    label: "Ordered recently",
    description: "A paid order in the last 30 days",
    matches: (customer, now) => customer.lastOrderAt !== null && now - Date.parse(customer.lastOrderAt) <= THIRTY_DAYS_MS,
  },
  {
    key: "lapsed",
    label: "Lapsed",
    description: "Last paid order more than 30 days ago",
    matches: (customer, now) => customer.lastOrderAt !== null && now - Date.parse(customer.lastOrderAt) > THIRTY_DAYS_MS,
  },
  { key: "never", label: "Never ordered", description: "On file, no paid order yet", matches: (customer) => customer.lastOrderAt === null },
  { key: "regulars", label: "Regulars", description: "Five or more paid orders", matches: (customer) => customer.orderCount >= 5 },
];

export function CustomersTable({ customers }: { customers: readonly CustomerRow[] }) {
  const [search, setSearch] = useState("");
  const [segment, setSegment] = useState<Segment>("all");
  // Captured once on mount, not on every render — a segment boundary that
  // drifts mid-session is how a row disappears while someone is reading it.
  const [now] = useState(() => Date.now());
  const normalised = search.trim().toLowerCase();

  const counts = useMemo(
    () => new Map(SEGMENTS.map((item) => [item.key, customers.filter((customer) => item.matches(customer, now)).length])),
    [customers, now],
  );

  const filtered = useMemo(() => {
    const matches = SEGMENTS.find((item) => item.key === segment)?.matches ?? (() => true);
    return customers.filter((customer) => {
      if (!matches(customer, now)) return false;
      if (normalised === "") return true;
      return (customer.name ?? "").toLowerCase().includes(normalised) || (customer.phone ?? "").includes(normalised);
    });
  }, [customers, segment, now, normalised]);

  const active = SEGMENTS.find((item) => item.key === segment);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="max-w-full overflow-x-auto rounded-lg border border-border" role="tablist" aria-label="Customer segment">
          <div className="inline-flex divide-x divide-border">
            {SEGMENTS.map((item) => (
              <button
                key={item.key}
                type="button"
                role="tab"
                aria-selected={segment === item.key}
                title={item.description}
                onClick={() => setSegment(item.key)}
                className={cn(
                  "whitespace-nowrap px-3.5 py-2 text-sm transition-colors first:rounded-l-lg last:rounded-r-lg",
                  segment === item.key ? "bg-surface-muted font-semibold text-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {item.label} <span className="tabular text-xs">({counts.get(item.key) ?? 0})</span>
              </button>
            ))}
          </div>
        </div>
        <div className="relative ml-auto w-full max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search name or phone"
            aria-label="Search customers"
            className="h-9 pl-8"
          />
        </div>
      </div>
      {active && active.key !== "all" && <p className="text-sm text-muted-foreground">{active.description}.</p>}

      <div className="overflow-hidden rounded-lg border border-border bg-surface">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Customer</TableHead>
              <TableHead className="text-right">Orders</TableHead>
              <TableHead className="text-right">Total spent</TableHead>
              <TableHead className="hidden text-right sm:table-cell">Last order</TableHead>
              <TableHead className="hidden text-right md:table-cell">Stamps</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="h-24 whitespace-normal text-center text-muted-foreground">
                  {customers.length === 0 ? "No customers yet." : segment !== "all" && normalised === "" ? "No customers in this segment." : "No customers match that search."}
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((customer) => (
                <TableRow key={customer.id}>
                  <TableCell>
                    <Link href={`/app/customers/${customer.id}`} className="flex flex-col gap-0.5 hover:underline">
                      <span className="font-semibold">{customer.name ?? "Unnamed"}</span>
                      {customer.phone && <span className="tabular text-xs text-muted-foreground">{customer.phone}</span>}
                    </Link>
                  </TableCell>
                  <TableCell className="tabular text-right">{customer.orderCount}</TableCell>
                  <TableCell className="tabular text-right font-semibold">{formatINR(customer.totalSpend, "whole")}</TableCell>
                  <TableCell className="tabular hidden text-right text-muted-foreground sm:table-cell">
                    {formatDate(customer.lastOrderAt)}
                  </TableCell>
                  <TableCell className="hidden text-right md:table-cell">
                    <Badge variant="outline">{customer.stampCount}</Badge>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
