import type { Metadata } from "next";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { MiniStat } from "@/components/staff/mini-stat";
import { PageHeader } from "@/components/staff/page-header";
import { EmptyState, PermissionDenied } from "@/components/states";
import { requireStaff, staffCan } from "@/lib/auth";
import { add, formatBps, formatINR } from "@/lib/money";
import { type PromotionRow, listPromotions } from "@/lib/repositories/promotions";

export const metadata: Metadata = { title: "Promotions", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

type State = "live" | "scheduled" | "expired" | "exhausted" | "off";

/** A promotion's state is four facts on its row and the clock — nothing else. */
function stateOf(promotion: PromotionRow, now: number): State {
  if (!promotion.isActive) return "off";
  if (promotion.usageLimit !== null && promotion.usageCount >= promotion.usageLimit) return "exhausted";
  if (promotion.startsAt && promotion.startsAt.getTime() > now) return "scheduled";
  if (promotion.endsAt && promotion.endsAt.getTime() < now) return "expired";
  return "live";
}

const STATE_LABEL: Record<State, { label: string; variant: "secondary" | "outline" | "destructive" }> = {
  live: { label: "Live", variant: "secondary" },
  scheduled: { label: "Scheduled", variant: "outline" },
  expired: { label: "Expired", variant: "outline" },
  exhausted: { label: "Used up", variant: "outline" },
  off: { label: "Off", variant: "destructive" },
};

function offer(promotion: PromotionRow): string {
  if (promotion.discountBps !== null) return `${formatBps(promotion.discountBps, 0)} off`;
  if (promotion.discountAmount !== null) return `${formatINR(promotion.discountAmount, "whole")} off`;
  return "—";
}

function when(date: Date | null): string {
  return date ? date.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric" }) : "—";
}

/** The rows plus the instant they were read — `now` belongs to the snapshot, not to the render. */
async function snapshot(orgId: string) {
  return { promotions: await listPromotions(orgId), now: Date.now() };
}

/**
 * CUSTOMERS › Promotions — every code, what it offers, when it runs, and
 * what it has actually done. Read-only: creating or editing a promotion is
 * a pricing decision (it changes what an order costs) and gets its own
 * approval. Gated on `orders.discount`, the permission for applying a
 * discount at the counter — if you may apply a code, you may see the codes.
 */
export default async function PromotionsPage() {
  const staff = await requireStaff();
  if (!(await staffCan("orders.discount"))) {
    return (
      <div className="mx-auto w-full max-w-lg px-[var(--gutter)] py-16">
        <PermissionDenied action="view promotions" />
      </div>
    );
  }

  const { promotions, now } = await snapshot(staff.orgId);
  const live = promotions.filter((promotion) => stateOf(promotion, now) === "live").length;
  const totalOrders = promotions.reduce((sum, promotion) => sum + promotion.performance.orders, 0);
  const totalDiscount = add(...promotions.map((promotion) => promotion.performance.discountGiven));
  const totalRevenue = add(...promotions.map((promotion) => promotion.performance.revenue));

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-[var(--gutter)] py-8">
      <PageHeader
        title="Promotions"
        description="Every code, what it offers, and what it has actually done — measured from paid orders, not from how often it was typed in."
      />

      {promotions.length === 0 ? (
        <EmptyState title="No promotions yet." detail="Codes will appear here once they exist. Creating one is a pricing change and needs its own approval." />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <MiniStat label="Live now" value={String(live)} hint={`${promotions.length} ${promotions.length === 1 ? "code" : "codes"} in total`} />
            <MiniStat label="Orders with a code" value={String(totalOrders)} hint="Paid, not cancelled" />
            <MiniStat label="Revenue on those orders" value={formatINR(totalRevenue, "whole")} hint="After the discount, GST-inclusive" />
            <MiniStat label="Discount given" value={formatINR(totalDiscount, "whole")} hint="What the codes cost" />
          </div>

          <div className="overflow-hidden rounded-lg border border-border bg-surface">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Code</TableHead>
                  <TableHead>State</TableHead>
                  <TableHead>Offer</TableHead>
                  <TableHead className="hidden md:table-cell">Runs</TableHead>
                  <TableHead className="hidden text-right sm:table-cell">Applied</TableHead>
                  <TableHead className="text-right">Paid orders</TableHead>
                  <TableHead className="hidden text-right md:table-cell">Revenue</TableHead>
                  <TableHead className="hidden text-right lg:table-cell">Discount given</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {promotions.map((promotion) => {
                  const state = STATE_LABEL[stateOf(promotion, now)];
                  return (
                    <TableRow key={promotion.id}>
                      <TableCell>
                        <div className="flex flex-col gap-0.5">
                          <span className="font-mono text-sm font-semibold">{promotion.code}</span>
                          <span className="text-xs text-muted-foreground">{promotion.name}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant={state.variant}>{state.label}</Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-0.5">
                          <span className="tabular font-semibold">{offer(promotion)}</span>
                          <span className="text-xs text-muted-foreground">
                            {[
                              promotion.minOrderAmount ? `min ${formatINR(promotion.minOrderAmount, "whole")}` : null,
                              promotion.maxDiscountAmount ? `up to ${formatINR(promotion.maxDiscountAmount, "whole")}` : null,
                            ]
                              .filter(Boolean)
                              .join(" · ") || "No conditions"}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="tabular hidden text-muted-foreground md:table-cell">
                        {promotion.startsAt || promotion.endsAt ? `${when(promotion.startsAt)} → ${when(promotion.endsAt)}` : "Always"}
                      </TableCell>
                      <TableCell className="tabular hidden text-right text-muted-foreground sm:table-cell">
                        {promotion.usageCount}
                        {promotion.usageLimit !== null ? ` / ${promotion.usageLimit}` : ""}
                      </TableCell>
                      <TableCell className="tabular text-right font-semibold">{promotion.performance.orders}</TableCell>
                      <TableCell className="tabular hidden text-right md:table-cell">{formatINR(promotion.performance.revenue, "whole")}</TableCell>
                      <TableCell className="tabular hidden text-right text-muted-foreground lg:table-cell">
                        {promotion.performance.discountGiven === 0n ? "—" : formatINR(promotion.performance.discountGiven, "whole")}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </>
      )}
    </div>
  );
}
