import type { Metadata } from "next";
import { ReceiptDesigner } from "@/components/receipt/designer";
import { PermissionDenied } from "@/components/states";
import { requireStaff, staffCan } from "@/lib/auth";
import { getReceiptDesign } from "@/lib/repositories/receipt";

export const metadata: Metadata = { title: "Bill & Receipt", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/**
 * ADMIN › Bill & Receipt. The designer for what the till prints.
 * `settings.manage` (OWNER) — the same gate every action behind it
 * re-checks. The cashier never sees this page; the POS simply prints
 * whatever design was last applied.
 */
export default async function ReceiptDesignerPage() {
  const staff = await requireStaff();
  if (!(await staffCan("settings.manage"))) {
    return (
      <div className="mx-auto w-full max-w-lg px-[var(--gutter)] py-16">
        <PermissionDenied action="design the receipt" />
      </div>
    );
  }

  const design = await getReceiptDesign(staff.orgId);
  return (
    <ReceiptDesigner
      draft={design.draft}
      hasActive={design.active !== null}
      hasPrevious={design.previous !== null}
      draftUpdatedAt={design.draftUpdatedAt?.toISOString() ?? null}
      appliedAt={design.appliedAt?.toISOString() ?? null}
    />
  );
}
