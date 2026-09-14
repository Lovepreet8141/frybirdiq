"use client";

import { Fragment, useState } from "react";
import {
  type ColumnDef,
  type ExpandedState,
  type RowData,
  type SortingState,
  createColumnHelper,
  createExpandedRowModel,
  createPaginatedRowModel,
  createSortedRowModel,
  flexRender,
  rowExpandingFeature,
  rowPaginationFeature,
  rowSortingFeature,
  tableFeatures,
  useTable,
} from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

/**
 * The one table engine the IQ surface uses — the purchased `tables12`
 * mechanics (sortable headers, page-size select, numbered pagination) on
 * TanStack Table v9's own API. Callers own their toolbar: search and
 * filters narrow `data` before it arrives here, so every screen's filter
 * vocabulary stays its own while sorting and paging look identical.
 *
 * Expanding is the purchased `data-table2` pattern — a chevron column the
 * caller adds with `expandColumn()`, and a full-width detail row rendered
 * by `renderExpanded` beneath the row that opened it.
 */
export const dataTableFeatures = tableFeatures({
  rowSortingFeature,
  rowPaginationFeature,
  rowExpandingFeature,
  sortedRowModel: createSortedRowModel(),
  paginatedRowModel: createPaginatedRowModel(),
  expandedRowModel: createExpandedRowModel(),
  columnMeta: {} as { align?: "right"; className?: string },
});

export type DataTableFeatures = typeof dataTableFeatures;
/** A column built by `dataColumns<T>()`; `any` for the cell value is TanStack's own choice for a heterogeneous column list. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type DataTableColumn<T extends RowData> = ColumnDef<DataTableFeatures, T, any>;

export function dataColumns<T extends RowData>() {
  return createColumnHelper<DataTableFeatures, T>();
}

/** The `data-table2` expand chevron: first column, no header, rotates when the row is open. */
export function expandColumn<T extends RowData>(): DataTableColumn<T> {
  return dataColumns<T>().display({
    id: "expand",
    header: () => <span className="sr-only">Details</span>,
    cell: ({ row }) => (
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={(event) => {
          event.stopPropagation();
          row.toggleExpanded();
        }}
        aria-expanded={row.getIsExpanded()}
        aria-label={row.getIsExpanded() ? "Collapse row" : "Expand row"}
      >
        <ChevronRight className={cn("size-4 transition-transform duration-[120ms]", row.getIsExpanded() && "rotate-90")} aria-hidden="true" />
      </Button>
    ),
    meta: { className: "w-10 pr-0" },
  });
}

const PAGE_SIZES = [10, 20, 50] as const;

function pageNumbers(current: number, total: number): (number | "ellipsis")[] {
  if (total <= 7) return Array.from({ length: total }, (_, index) => index + 1);
  if (current <= 3 || current >= total - 2) return [1, 2, 3, "ellipsis", total - 2, total - 1, total];
  return [1, "ellipsis", current - 1, current, current + 1, "ellipsis", total];
}

export function DataTable<T extends RowData>({
  columns,
  data,
  rowKey,
  initialSorting = [],
  pageSize = 20,
  noun = "rows",
  totalCount,
  empty,
  onRowClick,
  renderExpanded,
  className,
}: {
  columns: readonly DataTableColumn<T>[];
  data: readonly T[];
  rowKey: (row: T) => string;
  initialSorting?: SortingState;
  pageSize?: (typeof PAGE_SIZES)[number];
  /** "1–20 of 49 products" */
  noun?: string;
  /** The unfiltered count, when `data` has been narrowed by the caller's toolbar. */
  totalCount?: number;
  /** What to show when `data` is empty. */
  empty: React.ReactNode;
  onRowClick?: (row: T) => void;
  /** With `expandColumn()` in `columns`: the detail row shown under an open row. Clicking a row toggles it when there is no `onRowClick`. */
  renderExpanded?: (row: T) => React.ReactNode;
  className?: string;
}) {
  const [sorting, setSorting] = useState<SortingState>(initialSorting);
  const [expanded, setExpanded] = useState<ExpandedState>({});
  const table = useTable({
    features: dataTableFeatures,
    columns: [...columns],
    data,
    getRowId: (row) => rowKey(row),
    state: { sorting, expanded },
    onSortingChange: setSorting,
    onExpandedChange: setExpanded,
    getRowCanExpand: () => renderExpanded !== undefined,
    initialState: { pagination: { pageIndex: 0, pageSize } },
    autoResetPageIndex: true,
  });

  const { pageIndex, pageSize: size } = table.state.pagination;
  const currentPage = pageIndex + 1;
  const pageCount = Math.max(1, table.getPageCount());
  const first = data.length === 0 ? 0 : pageIndex * size + 1;
  const last = Math.min(data.length, (pageIndex + 1) * size);

  return (
    <div className={cn("overflow-hidden rounded-xl border border-border bg-panel", className)}>
      <Table>
        <TableHeader>
          {table.getHeaderGroups().map((headerGroup) => (
            <TableRow key={headerGroup.id} className="hover:bg-transparent">
              {headerGroup.headers.map((header) => {
                const meta = header.column.columnDef.meta;
                const sorted = header.column.getIsSorted();
                return (
                  <TableHead key={header.id} className={cn(meta?.align === "right" && "text-right", meta?.className)} aria-sort={sorted === "asc" ? "ascending" : sorted === "desc" ? "descending" : undefined}>
                    {header.column.getCanSort() ? (
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
                {empty}
              </TableCell>
            </TableRow>
          ) : (
            table.getRowModel().rows.map((row) => {
              const activate = onRowClick ? () => onRowClick(row.original) : renderExpanded ? () => row.toggleExpanded() : undefined;
              const open = renderExpanded !== undefined && row.getIsExpanded();
              return (
                <Fragment key={rowKey(row.original)}>
                  <TableRow
                    data-state={open ? "open" : undefined}
                    {...(activate
                      ? {
                          tabIndex: 0,
                          role: "button" as const,
                          onClick: activate,
                          onKeyDown: (event: React.KeyboardEvent) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              activate();
                            }
                          },
                          className: cn("cursor-pointer focus-visible:bg-muted/60 focus-visible:outline-none", open && "bg-muted/40"),
                        }
                      : {})}
                  >
                    {row.getAllCells().map((cell) => {
                      const meta = cell.column.columnDef.meta;
                      return (
                        <TableCell key={cell.id} className={cn(meta?.align === "right" && "text-right", meta?.className)}>
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </TableCell>
                      );
                    })}
                  </TableRow>
                  {open && renderExpanded && (
                    <TableRow className="hover:bg-transparent">
                      <TableCell colSpan={columns.length} className="whitespace-normal bg-muted/50 p-0">
                        {renderExpanded(row.original)}
                      </TableCell>
                    </TableRow>
                  )}
                </Fragment>
              );
            })
          )}
        </TableBody>
      </Table>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3">
        <div className="flex items-center gap-3">
          <p className="tabular text-[13px] text-muted-foreground">
            {data.length === 0 ? `0 ${noun}` : `${first}–${last} of ${data.length} ${noun}`}
            {totalCount !== undefined && totalCount !== data.length && ` · ${totalCount} in total`}
          </p>
          <Select value={String(size)} onValueChange={(value) => table.setPageSize(Number(value))}>
            <SelectTrigger size="sm" className="w-[88px]" aria-label="Rows per page">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PAGE_SIZES.map((option) => (
                <SelectItem key={option} value={String(option)}>
                  {option} rows
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
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
              <Button key={page} variant={currentPage === page ? "inverse" : "ghost"} size="icon-sm" className="tabular" onClick={() => table.setPageIndex(page - 1)} aria-current={currentPage === page ? "page" : undefined} aria-label={`Page ${page}`}>
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
  );
}
