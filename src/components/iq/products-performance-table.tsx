"use client";

import { useMemo, useState } from "react";
import { Download, ListFilter, Search } from "lucide-react";
import { DataTable, dataColumns } from "@/components/iq/data-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { type Paise, formatAmount, formatBps, formatINR } from "@/lib/money";
import { cn } from "@/lib/utils";

export interface ProductPerformanceRow {
  readonly key: string;
  readonly productId: string | null;
  readonly matchedBy: "id" | "name" | null;
  readonly name: string;
  readonly category: string | null;
  readonly isActive: boolean;
  readonly quantity: number;
  readonly orders: number;
  readonly revenue: Paise;
  readonly changeBps: number | null;
  readonly shareBps: number;
  readonly averagePaid: Paise;
  readonly recipe: { readonly linked: boolean; readonly ingredientCount: number };
}

const column = dataColumns<ProductPerformanceRow>();

function delta(changeBps: number | null): string {
  if (changeBps === null) return "—";
  return `${changeBps > 0 ? "+" : ""}${formatBps(changeBps, 1)}`;
}

function csvCell(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

/**
 * Every product's performance over the period on the shared `DataTable`
 * (the purchased `tables12` mechanics). Search, a category filter menu
 * and CSV export are this screen's toolbar; the figures are the server's.
 */
export function ProductsPerformanceTable({ products, periodLabel, canExport }: { products: readonly ProductPerformanceRow[]; periodLabel: string; canExport: boolean }) {
  const [search, setSearch] = useState("");
  const [categories, setCategories] = useState<ReadonlySet<string>>(new Set());
  const [showRemoved, setShowRemoved] = useState(true);

  const categoryOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const row of products) counts.set(row.category ?? "Uncategorised", (counts.get(row.category ?? "Uncategorised") ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [products]);

  const normalised = search.trim().toLowerCase();
  const rows = useMemo(
    () =>
      products.filter((row) => {
        if (!showRemoved && row.productId === null) return false;
        if (categories.size > 0 && !categories.has(row.category ?? "Uncategorised")) return false;
        if (normalised === "") return true;
        return row.name.toLowerCase().includes(normalised) || (row.category ?? "").toLowerCase().includes(normalised);
      }),
    [products, categories, showRemoved, normalised],
  );

  const columns = useMemo(
    () =>
      column.columns([
      column.accessor((row) => row.name, {
        id: "name",
        header: "Product",
        cell: ({ row }) => (
          <div className="flex flex-col gap-0.5">
            <span className="font-semibold">{row.original.name}</span>
            <span className="text-xs text-muted-foreground">
              {row.original.productId === null ? "Removed from menu" : (row.original.category ?? "Uncategorised")}
              {row.original.matchedBy === "name" && (
                <span className="ml-1 text-muted-foreground/70" title="These sales were recorded before order lines carried the product id; they are tied to the product by its name.">
                  · by name
                </span>
              )}
              {row.original.productId !== null && !row.original.isActive ? " · inactive" : ""}
            </span>
          </div>
        ),
      }),
      column.accessor((row) => row.quantity, { id: "units", header: "Units", meta: { align: "right" }, cell: ({ row }) => <span className="tabular">{row.original.quantity}</span> }),
      column.accessor((row) => row.orders, { id: "orders", header: "Orders", meta: { align: "right", className: "hidden sm:table-cell" }, cell: ({ row }) => <span className="tabular text-muted-foreground">{row.original.orders}</span> }),
      column.accessor((row) => Number(row.revenue), { id: "revenue", header: "Revenue", meta: { align: "right" }, cell: ({ row }) => <span className="tabular font-semibold">{formatINR(row.original.revenue, "whole")}</span> }),
      column.accessor((row) => row.changeBps ?? Number.NEGATIVE_INFINITY, {
        id: "delta",
        header: "vs previous",
        meta: { align: "right", className: "hidden md:table-cell" },
        cell: ({ row }) => <span className={cn("tabular", row.original.changeBps === null ? "text-muted-foreground" : row.original.changeBps > 0 ? "text-gain" : row.original.changeBps < 0 ? "text-loss" : "text-muted-foreground")}>{delta(row.original.changeBps)}</span>,
      }),
      column.accessor((row) => row.shareBps, { id: "share", header: "Share", meta: { align: "right", className: "hidden md:table-cell" }, cell: ({ row }) => <span className="tabular text-muted-foreground">{formatBps(row.original.shareBps, 1)}</span> }),
      column.accessor((row) => Number(row.averagePaid), { id: "avg", header: "Avg paid", meta: { align: "right", className: "hidden lg:table-cell" }, cell: ({ row }) => <span className="tabular">{formatINR(row.original.averagePaid)}</span> }),
      column.accessor((row) => (row.productId === null ? -1 : row.recipe.ingredientCount), {
        id: "recipe",
        header: "Recipe",
        meta: { className: "hidden lg:table-cell" },
        cell: ({ row }) =>
          row.original.productId === null ? (
            <span className="text-xs text-muted-foreground">—</span>
          ) : row.original.recipe.ingredientCount > 0 ? (
            <Badge variant="outline">{row.original.recipe.ingredientCount} ingredients</Badge>
          ) : row.original.recipe.linked ? (
            <Badge variant="outline">No lines yet</Badge>
          ) : (
            <Badge variant="destructive">No recipe</Badge>
          ),
      }),
      ]),
    [],
  );

  const exportCsv = () => {
    const header = ["Product", "Category", "Units", "Orders", "Revenue (INR)", "vs previous", "Share", "Avg paid (INR)", "Recipe lines"];
    const lines = rows.map((row) =>
      [
        row.name,
        row.productId === null ? "Removed from menu" : (row.category ?? "Uncategorised"),
        String(row.quantity),
        String(row.orders),
        formatAmount(row.revenue, "unit").replaceAll(",", ""),
        delta(row.changeBps),
        formatBps(row.shareBps, 1),
        formatAmount(row.averagePaid, "unit").replaceAll(",", ""),
        row.productId === null ? "" : String(row.recipe.ingredientCount),
      ]
        .map(csvCell)
        .join(","),
    );
    const url = URL.createObjectURL(new Blob([[header.map(csvCell).join(","), ...lines].join("\n")], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `products-${periodLabel.toLowerCase().replaceAll(" ", "-")}-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const removed = products.filter((row) => row.productId === null).length;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search product or category" aria-label="Search products" className="h-9 pl-8" />
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline">
                <ListFilter data-icon="inline-start" aria-hidden="true" />
                Filter
                {(categories.size > 0 || !showRemoved) && <span className="tabular flex size-5 items-center justify-center rounded-full bg-inverse text-[11px] font-semibold text-inverse-foreground">{categories.size + (showRemoved ? 0 : 1)}</span>}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel>Category</DropdownMenuLabel>
              {categoryOptions.map(([name, count]) => (
                <DropdownMenuCheckboxItem
                  key={name}
                  checked={categories.has(name)}
                  onCheckedChange={() =>
                    setCategories((current) => {
                      const next = new Set(current);
                      if (next.has(name)) next.delete(name);
                      else next.add(name);
                      return next;
                    })
                  }
                >
                  {name} <span className="tabular ml-auto text-xs text-muted-foreground">{count}</span>
                </DropdownMenuCheckboxItem>
              ))}
              {removed > 0 && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuCheckboxItem checked={showRemoved} onCheckedChange={() => setShowRemoved((value) => !value)}>
                    Include removed from menu <span className="tabular ml-auto text-xs text-muted-foreground">{removed}</span>
                  </DropdownMenuCheckboxItem>
                </>
              )}
              {(categories.size > 0 || !showRemoved) && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={() => {
                      setCategories(new Set());
                      setShowRemoved(true);
                    }}
                  >
                    Clear filters
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
          {canExport && (
            <Button variant="outline" onClick={exportCsv} disabled={rows.length === 0}>
              <Download data-icon="inline-start" aria-hidden="true" />
              <span className="hidden sm:inline">Export</span>
              <span className="sr-only sm:hidden">Export CSV</span>
            </Button>
          )}
        </div>
      </div>

      <DataTable
        columns={columns}
        data={rows}
        rowKey={(row) => row.key}
        initialSorting={[{ id: "revenue", desc: true }]}
        noun="products"
        totalCount={products.length}
        empty={
          <>
            <p>Nothing matches{normalised ? ` “${search.trim()}”` : ""}.</p>
            <Button
              variant="link"
              className="mt-1 h-auto p-0 text-[13px]"
              onClick={() => {
                setSearch("");
                setCategories(new Set());
                setShowRemoved(true);
              }}
            >
              Clear search and filters
            </Button>
          </>
        }
      />
    </div>
  );
}
