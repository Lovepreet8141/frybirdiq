import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Plus } from "lucide-react";
import { AvailabilityBadge } from "@/components/iq/menu/availability-badge";
import { MenuSectionNav } from "@/components/iq/menu/menu-section-nav";
import { DataTrust } from "@/components/iq/ui";
import { PageHeader } from "@/components/staff/page-header";
import { EmptyState, PermissionDenied } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getStaff, staffCan } from "@/lib/auth";
import { formatINR } from "@/lib/money";
import { listDraftItems, listProductsAdmin } from "@/lib/repositories/menu-admin";

export const metadata: Metadata = { title: "Combos — FRYBIRD IQ", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/**
 * A combo is a product with `productType: "COMBO"` that bundles others
 * (`comboItems`); there is no separate entity. This is the product list
 * filtered to combos, pointed at each one's contents.
 */
export default async function CombosPage() {
  const staff = await getStaff();
  if (!staff) redirect("/sign-in");
  if (!(await staffCan("menu.view"))) {
    return (
      <div className="mx-auto w-full max-w-lg px-[var(--gutter)] py-16">
        <PermissionDenied action="manage the menu" />
      </div>
    );
  }

  const [canEdit, canPublish, products, drafts] = await Promise.all([staffCan("menu.edit"), staffCan("menu.publish"), listProductsAdmin(staff.orgId), listDraftItems(staff.orgId)]);
  const combos = products.filter((product) => product.productType === "COMBO");
  const live = combos.filter((product) => product.status === "PUBLISHED" && product.isActive).length;

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-[var(--gutter)] py-8">
      <PageHeader
        title="Combos"
        description="Bundles sold as one product at one price. A combo is created like any product with its type set to Combo; its contents are managed here."
        actions={
          canEdit && (
            <Button variant="inverse" asChild>
              <Link href="/app/iq/menu/products/new">
                <Plus data-icon="inline-start" aria-hidden="true" />
                New product
              </Link>
            </Button>
          )
        }
      />
      <MenuSectionNav current="combos" draftCount={drafts.length} canEdit={canEdit} canPublish={canPublish} />

      <DataTrust items={[{ tone: "gain", text: `${combos.length} ${combos.length === 1 ? "combo" : "combos"} · ${live} live on the menu` }]} />

      {combos.length === 0 ? (
        <EmptyState
          title="No combos yet"
          detail="Create a product, set its type to Combo on the Details tab, and it appears here with a place to add what it bundles."
          action={
            canEdit ? (
              <Button variant="inverse" asChild>
                <Link href="/app/iq/menu/products/new">
                  <Plus data-icon="inline-start" aria-hidden="true" />
                  Create a product
                </Link>
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-panel">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Combo</TableHead>
                <TableHead className="hidden md:table-cell">Category</TableHead>
                <TableHead className="text-right">Price</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="hidden sm:table-cell">Availability</TableHead>
                <TableHead className="text-right">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {combos.map((product) => (
                <TableRow key={product.id}>
                  <TableCell>
                    <Link href={`/app/iq/menu/combos/${product.id}`} className="flex items-center gap-3 hover:underline">
                      {product.image ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={product.image} alt="" className="size-9 shrink-0 rounded-md object-cover" />
                      ) : (
                        <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-[11px] font-semibold text-muted-foreground">No photo</span>
                      )}
                      <span className="flex flex-col gap-0.5">
                        <span className="font-semibold">{product.name}</span>
                        <span className="text-xs text-muted-foreground">{product.sku ?? " "}</span>
                      </span>
                    </Link>
                  </TableCell>
                  <TableCell className="hidden text-muted-foreground md:table-cell">{product.categoryName ?? "—"}</TableCell>
                  <TableCell className="tabular text-right font-semibold">{formatINR(product.basePrice)}</TableCell>
                  <TableCell>
                    <Badge variant={!product.isActive ? "outline" : product.status === "DRAFT" ? "warning" : "success"}>{!product.isActive ? "Archived" : product.status === "DRAFT" ? "Draft" : "Live"}</Badge>
                  </TableCell>
                  <TableCell className="hidden sm:table-cell">
                    <AvailabilityBadge status={product.availabilityStatus} isActive={product.isActive} />
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      <Button variant="outline" size="sm" asChild>
                        <Link href={`/app/iq/menu/combos/${product.id}`}>Contents</Link>
                      </Button>
                      <Button variant="ghost" size="sm" asChild>
                        <Link href={`/app/iq/menu/products/${product.id}`}>Edit</Link>
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
