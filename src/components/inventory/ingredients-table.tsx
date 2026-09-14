"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  type SortingState,
  createColumnHelper,
  createPaginatedRowModel,
  createSortedRowModel,
  flexRender,
  rowPaginationFeature,
  rowSortingFeature,
  tableFeatures,
  useTable,
} from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, ChevronsUpDown, Download, ListFilter, MoreHorizontal, Plus, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/states";
import { type Paise, formatBps, formatINR } from "@/lib/money";
import { cn } from "@/lib/utils";
import { IngredientForm, type SupplierOption } from "./ingredient-form";

export interface IngredientListRow {
  readonly id: string;
  readonly name: string;
  readonly sku: string | null;
  readonly baseUnit: "G" | "ML" | "PIECE";
  readonly costPerBaseUnit: Paise;
  readonly yieldBps: number;
  readonly wasteBps: number;
  readonly isPackaging: boolean;
  readonly isActive: boolean;
  readonly supplierName: string | null;
  readonly lastPricedAt: string | null;
}

const UNIT = { G: "g", ML: "ml", PIECE: "pc" } as const;

type Filter = "active" | "inactive" | "unpriced" | "packaging" | "food";
const FILTERS: readonly { readonly key: Filter; readonly label: string; readonly group: "Status" | "Price" | "Kind" }[] = [
  { key: "active", label: "Active", group: "Status" },
  { key: "inactive", label: "Inactive", group: "Status" },
  { key: "unpriced", label: "No price yet", group: "Price" },
  { key: "food", label: "Ingredients", group: "Kind" },
  { key: "packaging", label: "Packaging", group: "Kind" },
];
const PAGE_SIZES = [10, 20, 50] as const;

/** Sorting and pagination only. Search and the filter menu narrow the rows before they reach the table. */
const features = tableFeatures({
  rowSortingFeature,
  rowPaginationFeature,
  sortedRowModel: createSortedRowModel(),
  paginatedRowModel: createPaginatedRowModel(),
  columnMeta: {} as { align?: "right"; className?: string },
});
const column = createColumnHelper<typeof features, IngredientListRow>();

function matches(row: IngredientListRow, filters: ReadonlySet<Filter>): boolean {
  if (filters.has("active") && !row.isActive) return false;
  if (filters.has("inactive") && row.isActive) return false;
  if (filters.has("unpriced") && row.costPerBaseUnit !== 0n) return false;
  if (filters.has("packaging") && !row.isPackaging) return false;
  if (filters.has("food") && row.isPackaging) return false;
  return true;
}

/** tables12's page strip: every page up to seven, then the ends with the current page in the middle. */
function pageNumbers(current: number, total: number): (number | "ellipsis")[] {
  if (total <= 7) return Array.from({ length: total }, (_, index) => index + 1);
  if (current <= 3 || current >= total - 2) return [1, 2, 3, "ellipsis", total - 2, total - 1, total];
  return [1, "ellipsis", current - 1, current, current + 1, "ellipsis", total];
}

function pricedLabel(iso: string | null): string {
  if (!iso) return "Never";
  return new Date(iso).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short" });
}

function csvCell(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

/**
 * The ingredient list on the purchased `tables12` mechanics — sortable
 * headers, a checkbox filter menu, page-size select, numbered pagination,
 * a row action menu and CSV export — over FRYBIRD's own `Table` and tokens.
 * Its row selection, bulk edits, duplicate and delete were not adopted:
 * there is no inventory write path for them, and a control that cannot
 * act is worse than none. Rows are links; the actions menu only navigates.
 */
export function IngredientsTable({ ingredients, suppliers, canManage, canExport }: { ingredients: readonly IngredientListRow[]; suppliers: readonly SupplierOption[]; canManage: boolean; canExport: boolean }) {
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<ReadonlySet<Filter>>(new Set());
  const [sorting, setSorting] = useState<SortingState>([{ id: "name", desc: false }]);
  const [adding, setAdding] = useState(false);

  const normalised = search.trim().toLowerCase();
  const rows = useMemo(
    () =>
      ingredients.filter((row) => {
        if (!matches(row, filters)) return false;
        if (normalised === "") return true;
        return row.name.toLowerCase().includes(normalised) || (row.sku ?? "").toLowerCase().includes(normalised) || (row.supplierName ?? "").toLowerCase().includes(normalised);
      }),
    [ingredients, filters, normalised],
  );

  const columns = useMemo(
    () =>
      column.columns([
        column.accessor((row) => row.name, {
          id: "name",
          header: "Ingredient",
          cell: ({ row }) => (
            <Link href={`/app/inventory/ingredients/${row.original.id}`} className="flex flex-col gap-0.5 hover:underline">
              <span className="font-semibold">{row.original.name}</span>
              <span className="text-xs text-muted-foreground">{[row.original.sku, row.original.isPackaging ? "Packaging" : null].filter(Boolean).join(" · ") || " "}</span>
            </Link>
          ),
        }),
        column.accessor((row) => row.baseUnit, {
          id: "unit",
          header: "Unit",
          enableSorting: false,
          cell: ({ row }) => <span className="text-muted-foreground">{UNIT[row.original.baseUnit]}</span>,
        }),
        column.accessor((row) => Number(row.costPerBaseUnit), {
          id: "cost",
          header: "Usable cost",
          meta: { align: "right" },
          cell: ({ row }) =>
            row.original.costPerBaseUnit === 0n ? (
              <span className="text-muted-foreground">Not priced</span>
            ) : (
              <span className="tabular font-semibold">
                {formatINR(row.original.costPerBaseUnit)} / {UNIT[row.original.baseUnit]}
              </span>
            ),
        }),
        column.accessor((row) => row.yieldBps, {
          id: "yield",
          header: "Yield · waste",
          meta: { align: "right", className: "hidden md:table-cell" },
          cell: ({ row }) => (
            <span className="tabular text-muted-foreground">
              {formatBps(row.original.yieldBps, 0)} · {formatBps(row.original.wasteBps, 1)}
            </span>
          ),
        }),
        column.accessor((row) => row.supplierName ?? "", {
          id: "supplier",
          header: "Supplier",
          meta: { className: "hidden lg:table-cell" },
          cell: ({ row }) => <span className="text-muted-foreground">{row.original.supplierName ?? "—"}</span>,
        }),
        column.accessor((row) => (row.lastPricedAt ? new Date(row.lastPricedAt).getTime() : 0), {
          id: "priced",
          header: "Last priced",
          meta: { className: "hidden sm:table-cell" },
          cell: ({ row }) => <span className={cn("tabular", row.original.lastPricedAt ? "text-muted-foreground" : "text-flag")}>{pricedLabel(row.original.lastPricedAt)}</span>,
        }),
        column.accessor((row) => (row.isActive ? 1 : 0), {
          id: "status",
          header: "Status",
          cell: ({ row }) => <Badge variant={row.original.isActive ? "success" : "outline"}>{row.original.isActive ? "Active" : "Inactive"}</Badge>,
        }),
        column.display({
          id: "actions",
          header: () => <span className="sr-only">Actions</span>,
          enableSorting: false,
          meta: { align: "right", className: "w-12" },
          cell: ({ row }) => (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm" className="text-muted-foreground" aria-label={`Actions for ${row.original.name}`}>
                  <MoreHorizontal aria-hidden="true" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem asChild>
                  <Link href={`/app/inventory/ingredients/${row.original.id}`}>View ingredient</Link>
                </DropdownMenuItem>
                {canManage && (
                  <DropdownMenuItem asChild>
                    <Link href={`/app/inventory/ingredients/${row.original.id}#price`}>Record a price</Link>
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          ),
        }),
      ]),
    [canManage],
  );

  const table = useTable({
    features,
    columns,
    data: rows,
    state: { sorting },
    onSortingChange: setSorting,
    initialState: { pagination: { pageIndex: 0, pageSize: 20 } },
    autoResetPageIndex: true,
  });

  const { pageIndex, pageSize } = table.state.pagination;
  const currentPage = pageIndex + 1;
  const pageCount = Math.max(1, table.getPageCount());
  const first = rows.length === 0 ? 0 : pageIndex * pageSize + 1;
  const last = Math.min(rows.length, (pageIndex + 1) * pageSize);

  const toggleFilter = (key: Filter) =>
    setFilters((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const exportCsv = () => {
    const header = ["Ingredient", "SKU", "Kind", "Unit", "Usable cost (₹ per unit)", "Yield", "Waste", "Supplier", "Last priced", "Status"];
    const lines = table.getSortedRowModel().rows.map(({ original: row }) =>
      [
        row.name,
        row.sku ?? "",
        row.isPackaging ? "Packaging" : "Ingredient",
        UNIT[row.baseUnit],
        row.costPerBaseUnit === 0n ? "" : formatINR(row.costPerBaseUnit),
        formatBps(row.yieldBps, 0),
        formatBps(row.wasteBps, 1),
        row.supplierName ?? "",
        row.lastPricedAt ? new Date(row.lastPricedAt).toISOString().slice(0, 10) : "",
        row.isActive ? "Active" : "Inactive",
      ]
        .map(csvCell)
        .join(","),
    );
    const blob = new Blob([[header.map(csvCell).join(","), ...lines].join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `ingredients-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  if (ingredients.length === 0) {
    return (
      <>
        <EmptyState
          title="No ingredients yet"
          detail="Add what the kitchen buys — chicken, flour, oil, boxes — then record what you paid so recipes can be costed."
          action={
            canManage ? (
              <Button variant="inverse" onClick={() => setAdding(true)}>
                <Plus data-icon="inline-start" aria-hidden="true" />
                Add the first ingredient
              </Button>
            ) : (
              <p className="text-[13px] text-muted-foreground">Adding ingredients needs the purchasing permission.</p>
            )
          }
        />
        <AddDialog open={adding} onOpenChange={setAdding} suppliers={suppliers} />
      </>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search name, SKU or supplier" aria-label="Search ingredients" className="h-9 pl-8" />
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline">
                <ListFilter data-icon="inline-start" aria-hidden="true" />
                Filter
                {filters.size > 0 && <span className="tabular flex size-5 items-center justify-center rounded-full bg-inverse text-[11px] font-semibold text-inverse-foreground">{filters.size}</span>}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              {(["Status", "Price", "Kind"] as const).map((group, index) => (
                <div key={group}>
                  {index > 0 && <DropdownMenuSeparator />}
                  <DropdownMenuLabel>{group}</DropdownMenuLabel>
                  {FILTERS.filter((item) => item.group === group).map((item) => (
                    <DropdownMenuCheckboxItem key={item.key} checked={filters.has(item.key)} onCheckedChange={() => toggleFilter(item.key)}>
                      {item.label}
                    </DropdownMenuCheckboxItem>
                  ))}
                </div>
              ))}
              {filters.size > 0 && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => setFilters(new Set())}>Clear filters</DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>

          <Select value={String(pageSize)} onValueChange={(value) => table.setPageSize(Number(value))}>
            <SelectTrigger size="sm" className="w-[88px]" aria-label="Rows per page">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PAGE_SIZES.map((size) => (
                <SelectItem key={size} value={String(size)}>
                  {size} rows
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {canExport && (
            <Button variant="outline" onClick={exportCsv} disabled={rows.length === 0}>
              <Download data-icon="inline-start" aria-hidden="true" />
              <span className="hidden sm:inline">Export</span>
              <span className="sr-only sm:hidden">Export CSV</span>
            </Button>
          )}
          {canManage && (
            <Button variant="inverse" onClick={() => setAdding(true)}>
              <Plus data-icon="inline-start" aria-hidden="true" />
              Add ingredient
            </Button>
          )}
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-panel">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id} className="hover:bg-transparent">
                {headerGroup.headers.map((header) => {
                  const meta = header.column.columnDef.meta;
                  const sorted = header.column.getIsSorted();
                  const canSort = header.column.getCanSort();
                  return (
                    <TableHead key={header.id} className={cn(meta?.align === "right" && "text-right", meta?.className)} aria-sort={sorted === "asc" ? "ascending" : sorted === "desc" ? "descending" : undefined}>
                      {header.isPlaceholder ? null : canSort ? (
                        <button
                          type="button"
                          onClick={header.column.getToggleSortingHandler()}
                          className={cn("inline-flex min-h-[32px] items-center gap-1 rounded-sm hover:text-foreground", meta?.align === "right" && "flex-row-reverse", sorted && "text-foreground")}
                        >
                          {flexRender(header.column.columnDef.header, header.getContext())}
                          {sorted === "asc" ? <ArrowUp className="size-3.5" aria-hidden="true" /> : sorted === "desc" ? <ArrowDown className="size-3.5" aria-hidden="true" /> : <ChevronsUpDown className="size-3.5 text-muted-foreground/70" aria-hidden="true" />}
                        </button>
                      ) : (
                        flexRender(header.column.columnDef.header, header.getContext())
                      )}
                    </TableHead>
                  );
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={columns.length} className="h-28 whitespace-normal text-center text-muted-foreground">
                  <p>Nothing matches{normalised ? ` “${search.trim()}”` : ""}.</p>
                  <Button
                    variant="link"
                    className="mt-1 h-auto p-0 text-[13px]"
                    onClick={() => {
                      setSearch("");
                      setFilters(new Set());
                    }}
                  >
                    Clear search and filters
                  </Button>
                </TableCell>
              </TableRow>
            ) : (
              table.getRowModel().rows.map((row) => (
                <TableRow key={row.original.id}>
                  {row.getAllCells().map((cell) => {
                    const meta = cell.column.columnDef.meta;
                    return (
                      <TableCell key={cell.id} className={cn(meta?.align === "right" && "text-right", meta?.className)}>
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </TableCell>
                    );
                  })}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3">
          <p className="tabular text-[13px] text-muted-foreground">
            {rows.length === 0 ? "0 ingredients" : `${first}–${last} of ${rows.length}`}
            {rows.length !== ingredients.length && ` · ${ingredients.length} in total`}
          </p>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="sm" onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()}>
              <ChevronLeft data-icon="inline-start" aria-hidden="true" />
              <span className="hidden sm:inline">Previous</span>
            </Button>
            {pageNumbers(currentPage, pageCount).map((page, index) =>
              page === "ellipsis" ? (
                <span key={`ellipsis-${index}`} className="px-1.5 text-muted-foreground">
                  …
                </span>
              ) : (
                <Button
                  key={page}
                  variant={currentPage === page ? "inverse" : "ghost"}
                  size="icon-sm"
                  className="tabular"
                  onClick={() => table.setPageIndex(page - 1)}
                  aria-current={currentPage === page ? "page" : undefined}
                  aria-label={`Page ${page}`}
                >
                  {page}
                </Button>
              ),
            )}
            <Button variant="ghost" size="sm" onClick={() => table.nextPage()} disabled={!table.getCanNextPage()}>
              <span className="hidden sm:inline">Next</span>
              <ChevronRight data-icon="inline-end" aria-hidden="true" />
            </Button>
          </div>
        </div>
      </div>

      <AddDialog open={adding} onOpenChange={setAdding} suppliers={suppliers} />
    </div>
  );
}

function AddDialog({ open, onOpenChange, suppliers }: { open: boolean; onOpenChange: (open: boolean) => void; suppliers: readonly SupplierOption[] }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add an ingredient</DialogTitle>
        </DialogHeader>
        {open && <IngredientForm suppliers={suppliers} />}
      </DialogContent>
    </Dialog>
  );
}
