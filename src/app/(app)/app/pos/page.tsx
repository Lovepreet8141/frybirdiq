import type { Metadata } from "next";
import { PosShell } from "@/components/pos/pos-shell";
import { PermissionDenied } from "@/components/states";
import { staffCan } from "@/lib/auth";
import { getMenu } from "@/lib/repositories/menu";

export const metadata: Metadata = { title: "POS", robots: { index: false, follow: false } };

// A counter screen: always today's menu and never a cached one.
export const dynamic = "force-dynamic";

/**
 * The POS shell and product grid. BUILD-PLAN.md Phase 4.
 *
 * Payment, receipts and order history are not built here — this screen only
 * builds and prices an order. `orders.create` gates it: a role that cannot
 * create an order (KITCHEN, RIDER, INVENTORY, ANALYST) is told so rather than
 * shown an empty grid. §41 — hiding the page is not the check; the pricing
 * action re-checks the same permission on every call.
 */
export default async function PosPage() {
  const canCreate = await staffCan("orders.create");

  if (!canCreate) {
    return (
      <div className="mx-auto w-full max-w-lg px-[var(--gutter)] py-16">
        <PermissionDenied action="build an order here" />
      </div>
    );
  }

  const menu = await getMenu();

  if (menu.length === 0) {
    return (
      <div className="mx-auto w-full max-w-lg px-[var(--gutter)] py-16">
        <p className="text-center text-muted-foreground">
          The menu is empty. Add categories and products before taking orders at the counter.
        </p>
      </div>
    );
  }

  return <PosShell categories={menu} />;
}
