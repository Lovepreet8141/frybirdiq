"use client";

import { useState } from "react";
import { Pencil, Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SupplierForm, type SupplierFormValues } from "./supplier-form";

export interface SupplierListRow extends SupplierFormValues {
  readonly id: string;
  readonly ingredientCount: number;
}

/**
 * Suppliers, with the "add in a dialog" idiom from the purchased `tables12`
 * block. Edit reuses the same dialog and form; the server decides what a
 * save may change.
 */
export function SuppliersTable({ suppliers, canManage }: { suppliers: readonly SupplierListRow[]; canManage: boolean }) {
  const [editing, setEditing] = useState<SupplierFormValues | "new" | null>(null);

  return (
    <div className="flex flex-col gap-4">
      {canManage && (
        <div className="flex justify-end">
          <Button variant="inverse" onClick={() => setEditing("new")}>
            <Plus data-icon="inline-start" aria-hidden="true" />
            Add supplier
          </Button>
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-border bg-panel">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Supplier</TableHead>
              <TableHead className="hidden sm:table-cell">Contact</TableHead>
              <TableHead className="hidden md:table-cell">GSTIN</TableHead>
              <TableHead className="text-right">Ingredients</TableHead>
              <TableHead>Status</TableHead>
              {canManage && <TableHead className="w-10" aria-label="Actions" />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {suppliers.length === 0 ? (
              <TableRow>
                <TableCell colSpan={canManage ? 6 : 5} className="h-24 whitespace-normal text-center text-muted-foreground">
                  No suppliers yet. Add the people you buy from, then record prices against them.
                </TableCell>
              </TableRow>
            ) : (
              suppliers.map((supplier) => (
                <TableRow key={supplier.id}>
                  <TableCell>
                    <div className="flex flex-col gap-0.5">
                      <span className="font-semibold">{supplier.name}</span>
                      {supplier.address && <span className="truncate text-xs text-muted-foreground">{supplier.address}</span>}
                    </div>
                  </TableCell>
                  <TableCell className="hidden text-muted-foreground sm:table-cell">{[supplier.phone, supplier.email].filter(Boolean).join(" · ") || "—"}</TableCell>
                  <TableCell className="hidden font-mono text-[12px] tracking-[0.02em] md:table-cell">{supplier.gstin ?? "—"}</TableCell>
                  <TableCell className="tabular text-right">{supplier.ingredientCount}</TableCell>
                  <TableCell>
                    <Badge variant={supplier.isActive ? "success" : "outline"}>{supplier.isActive ? "Active" : "Inactive"}</Badge>
                  </TableCell>
                  {canManage && (
                    <TableCell>
                      <Button variant="ghost" size="icon-sm" onClick={() => setEditing(supplier)} aria-label={`Edit ${supplier.name}`} className="text-muted-foreground">
                        <Pencil aria-hidden="true" />
                      </Button>
                    </TableCell>
                  )}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing === "new" ? "Add a supplier" : `Edit ${editing?.name ?? "supplier"}`}</DialogTitle>
          </DialogHeader>
          {editing !== null && <SupplierForm key={editing === "new" ? "new" : editing.id} initial={editing === "new" ? undefined : editing} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}
