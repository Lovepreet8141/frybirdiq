"use client";

import {
  createColumnHelper,
  createSortedRowModel,
  rowSortingFeature,
  sortFn_basic,
  sortFn_text,
  tableFeatures,
  useTable,
} from "@tanstack/react-table";
import { ArrowUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { type Paise, formatINR } from "@/lib/money";

export interface TopSeller {
  readonly name: string;
  readonly quantity: number;
  readonly revenue: Paise;
}

const features = tableFeatures({
  rowSortingFeature,
  sortedRowModel: createSortedRowModel(),
  sortFns: { basic: sortFn_basic, text: sortFn_text },
});

const helper = createColumnHelper<typeof features, TopSeller>();

const columns = helper.columns([
  helper.accessor("name", {
    header: "Product",
    sortFn: "text",
    cell: (info) => <span className="min-w-0 truncate">{info.getValue()}</span>,
  }),
  helper.accessor("quantity", {
    header: ({ column }) => <SortHeader column={column}>Qty</SortHeader>,
    sortFn: "basic",
    cell: (info) => <span className="tabular text-muted-foreground">{info.getValue()}</span>,
  }),
  helper.accessor("revenue", {
    header: ({ column }) => <SortHeader column={column}>Revenue</SortHeader>,
    sortFn: "basic",
    cell: (info) => <span className="tabular font-medium">{formatINR(info.getValue(), "whole")}</span>,
  }),
]);

function SortHeader({ column, children }: { column: { toggleSorting: (desc?: boolean) => void; getIsSorted: () => false | "asc" | "desc" }; children: React.ReactNode }) {
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
      className="h-auto gap-1 p-0! text-xs font-semibold text-muted-foreground hover:bg-transparent! hover:text-foreground"
    >
      {children}
      <ArrowUpDown className="size-3" />
    </Button>
  );
}

/**
 * By revenue by default — sortable by quantity too, since "what's popular"
 * and "what's paying for the kitchen" are different questions an owner asks.
 * No pagination, no filter: six rows, real data, nothing to page through.
 */
export function TopSellersTable({ products }: { products: readonly TopSeller[] }) {
  const table = useTable({
    features,
    columns,
    data: products as TopSeller[],
    initialState: { sorting: [{ id: "revenue", desc: true }] },
  });

  return (
    <Table>
      <TableHeader>
        {table.getHeaderGroups().map((headerGroup) => (
          <TableRow key={headerGroup.id}>
            {headerGroup.headers.map((header) => (
              <TableHead key={header.id} className={header.column.id === "name" ? "" : "text-right"}>
                {header.isPlaceholder ? null : <table.FlexRender header={header} />}
              </TableHead>
            ))}
          </TableRow>
        ))}
      </TableHeader>
      <TableBody>
        {table.getRowModel().rows.map((row) => (
          <TableRow key={row.id}>
            {row.getAllCells().map((cell) => (
              <TableCell key={cell.id} className={cell.column.id === "name" ? "" : "text-right"}>
                <table.FlexRender cell={cell} />
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
