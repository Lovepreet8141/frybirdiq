"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Plus, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
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
  readonly onHand: number;
}

const UNIT = { G: "g", ML: "ml", PIECE: "pc" } as const;
type Filter = "all" | "active" | "unpriced" | "packaging";

/**
 * Ingredients — the `tables12` shape (add-in-dialog, status filter,
 * sortable-ish columns) on the app's table shell. Cost is per base unit at
 * full paise precision because a bulk ingredient genuinely costs fractions
 * of a rupee per gram.
 */
export function IngredientsTable({ ingredients, suppliers, canManage }: { ingredients: readonly IngredientListRow[]; suppliers: readonly SupplierOption[]; canManage: boolean }) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [adding, setAdding] = useState(false);
  const normalised = search.trim().toLowerCase();

  const filtered = useMemo(
    () =>
      ingredients.filter((row) => {
        if (filter === "active" && !row.isActive) return false;
        if (filter === "unpriced" && row.costPerBaseUnit !== 0n) return false;
        if (filter === "packaging" && !row.isPackaging) return false;
        if (normalised === "") return true;
        return row.name.toLowerCase().includes(normalised) || (row.sku ?? "").toLowerCase().includes(normalised) || (row.supplierName ?? "").toLowerCase().includes(normalised);
      }),
    [ingredients, filter, normalised],
  );

  const counts: Record<Filter, number> = {
    all: ingredients.length,
    active: ingredients.filter((row) => row.isActive).length,
    unpriced: ingredients.filter((row) => row.costPerBaseUnit === 0n).length,
    packaging: ingredients.filter((row) => row.isPackaging).length,
  };
  const FILTERS: readonly { key: Filter; label: string }[] = [
    { key: "all", label: "All" },
    { key: "active", label: "Active" },
    { key: "unpriced", label: "No price yet" },
    { key: "packaging", label: "Packaging" },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="max-w-full overflow-x-auto rounded-[10px] border border-border bg-panel p-1" role="tablist" aria-label="Filter ingredients">
          <div className="inline-flex gap-0.5">
            {FILTERS.map((item) => (
              <button
                key={item.key}
                type="button"
                role="tab"
                aria-selected={filter === item.key}
                onClick={() => setFilter(item.key)}
                className={cn(
                  "h-7 whitespace-nowrap rounded-[7px] px-3 text-[13px] font-medium transition-colors duration-[120ms]",
                  filter === item.key ? "bg-secondary font-semibold text-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {item.label} <span className="tabular text-[12px] font-normal text-muted-foreground">{counts[item.key]}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="relative ml-auto w-full max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search name, SKU or supplier" aria-label="Search ingredients" className="h-9 pl-8" />
        </div>
        {canManage && (
          <Button variant="inverse" onClick={() => setAdding(true)}>
            <Plus data-icon="inline-start" aria-hidden="true" />
            Add ingredient
          </Button>
        )}
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-panel">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Ingredient</TableHead>
              <TableHead>Unit</TableHead>
              <TableHead className="text-right">Usable cost</TableHead>
              <TableHead className="hidden text-right md:table-cell">Yield · waste</TableHead>
              <TableHead className="hidden lg:table-cell">Supplier</TableHead>
              <TableHead className="hidden text-right sm:table-cell">On hand</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="h-24 whitespace-normal text-center text-muted-foreground">
                  {ingredients.length === 0 ? "No ingredients yet. Add what the kitchen buys, then record what you paid." : "Nothing matches."}
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((row) => (
                <TableRow key={row.id}>
                  <TableCell>
                    <Link href={`/app/inventory/ingredients/${row.id}`} className="flex flex-col gap-0.5 hover:underline">
                      <span className="font-semibold">{row.name}</span>
                      <span className="text-xs text-muted-foreground">{[row.sku, row.isPackaging ? "Packaging" : null].filter(Boolean).join(" · ") || " "}</span>
                    </Link>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{UNIT[row.baseUnit]}</TableCell>
                  <TableCell className="tabular text-right font-semibold">
                    {row.costPerBaseUnit === 0n ? <span className="font-normal text-muted-foreground">Not priced</span> : `${formatINR(row.costPerBaseUnit)} / ${UNIT[row.baseUnit]}`}
                  </TableCell>
                  <TableCell className="tabular hidden text-right text-muted-foreground md:table-cell">
                    {formatBps(row.yieldBps, 0)} · {formatBps(row.wasteBps, 1)}
                  </TableCell>
                  <TableCell className="hidden text-muted-foreground lg:table-cell">{row.supplierName ?? "—"}</TableCell>
                  <TableCell className="tabular hidden text-right sm:table-cell">
                    {row.onHand} {UNIT[row.baseUnit]}
                  </TableCell>
                  <TableCell>
                    <Badge variant={row.isActive ? "success" : "outline"}>{row.isActive ? "Active" : "Inactive"}</Badge>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog open={adding} onOpenChange={setAdding}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Add an ingredient</DialogTitle>
          </DialogHeader>
          {adding && <IngredientForm suppliers={suppliers} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}
