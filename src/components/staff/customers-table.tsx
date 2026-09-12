"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { type Paise, formatINR } from "@/lib/money";

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
export function CustomersTable({ customers }: { customers: readonly CustomerRow[] }) {
  const [search, setSearch] = useState("");
  const normalised = search.trim().toLowerCase();

  const filtered = useMemo(() => {
    if (normalised === "") return customers;
    return customers.filter(
      (customer) =>
        (customer.name ?? "").toLowerCase().includes(normalised) || (customer.phone ?? "").includes(normalised),
    );
  }, [customers, normalised]);

  return (
    <div className="flex flex-col gap-4">
      <div className="relative w-full max-w-xs">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search name or phone"
          aria-label="Search customers"
          className="h-9 pl-8"
        />
      </div>

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
                  {customers.length === 0 ? "No customers yet." : "No customers match that search."}
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
