import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { MiniStat } from "@/components/staff/mini-stat";
import { PageHeader } from "@/components/staff/page-header";
import { PermissionDenied } from "@/components/states";
import { ORDER_CHANNEL_LABELS } from "@/domain/order-channel";
import { requireStaff, staffCan } from "@/lib/auth";
import { formatINR } from "@/lib/money";
import { getCustomerProfile } from "@/lib/repositories/customers";

export const metadata: Metadata = { title: "Customer", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

function formatDate(date: Date | null): string {
  if (!date) return "Never";
  return date.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric" });
}

/**
 * Customer 360. Every figure is `getCustomerProfile`'s — orders and spend
 * count only paid sales, the same definition the dashboard uses. Loyalty
 * numbers (points, stamps, the threshold) are read straight from
 * `loyaltyAccounts`/`organizations` — nothing here recomputes a FRYBIRD
 * REWARDS rule; `src/lib/loyalty` remains the only place that does.
 */
export default async function CustomerProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const staff = await requireStaff();
  const canView = await staffCan("customers.view");

  if (!canView) {
    return (
      <div className="mx-auto w-full max-w-lg px-[var(--gutter)] py-16">
        <PermissionDenied action="view customers" />
      </div>
    );
  }

  const profile = await getCustomerProfile(staff.orgId, id);
  if (!profile) notFound();

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-[var(--gutter)] py-8">
      <PageHeader
        title={profile.name ?? "Unnamed customer"}
        description={[profile.phone, profile.email].filter(Boolean).join(" · ") || "No contact details on file."}
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <MiniStat label="Orders" value={String(profile.orderCount)} />
        <MiniStat label="Total spent" value={formatINR(profile.totalSpend, "whole")} />
        <MiniStat label="Average order" value={profile.orderCount === 0 ? "—" : formatINR(profile.averageOrder, "whole")} />
        <MiniStat label="Last order" value={formatDate(profile.lastOrderAt)} />
      </div>

      {profile.loyalty && (
        <Card>
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="font-heading text-lg font-semibold">FRYBIRD REWARDS</h2>
              <span className="tabular text-sm text-muted-foreground">{profile.loyalty.pointsBalance} points</span>
            </div>
            <div className="flex flex-col gap-1.5">
              <div className="flex items-baseline justify-between text-sm">
                <span className="text-muted-foreground">Stamp progress</span>
                <span className="tabular font-semibold">
                  {profile.loyalty.stampCount} / {profile.loyalty.stampsRequired}
                </span>
              </div>
              <Progress value={Math.min(100, (profile.loyalty.stampCount / profile.loyalty.stampsRequired) * 100)} />
            </div>
          </CardContent>
        </Card>
      )}

      {profile.favoriteProducts.length > 0 && (
        <Card>
          <CardContent className="flex flex-col gap-3">
            <h2 className="font-heading text-lg font-semibold">Favourite products</h2>
            <div className="flex flex-wrap gap-2">
              {profile.favoriteProducts.map((product) => (
                <Badge key={product.name} variant="outline">
                  {product.name} · {product.quantity}×
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="flex flex-col gap-3">
          <h2 className="font-heading text-lg font-semibold">Recent orders</h2>
          {profile.recentOrders.length === 0 ? (
            <p className="text-sm text-muted-foreground">No orders yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Order</TableHead>
                  <TableHead>Channel</TableHead>
                  <TableHead>Placed</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {profile.recentOrders.map((order) => (
                  <TableRow key={order.id}>
                    <TableCell className="tabular font-semibold">#{order.orderNumber}</TableCell>
                    <TableCell>{ORDER_CHANNEL_LABELS[order.channel]}</TableCell>
                    <TableCell className="tabular text-muted-foreground">
                      {order.placedAt ? formatDate(order.placedAt) : "—"}
                    </TableCell>
                    <TableCell className="tabular text-right font-semibold">{formatINR(order.grandTotal, "whole")}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
