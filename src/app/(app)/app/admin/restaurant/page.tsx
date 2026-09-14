import type { Metadata } from "next";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { OperationsSettingsForm } from "@/components/staff/operations-settings-form";
import { PageHeader } from "@/components/staff/page-header";
import { SettingRow } from "@/components/staff/setting-row";
import { EmptyState, PermissionDenied } from "@/components/states";
import { requireStaff, staffCan } from "@/lib/auth";
import { formatBps, formatINR } from "@/lib/money";
import { getRestaurantSettings } from "@/lib/repositories/settings";

export const metadata: Metadata = { title: "Restaurant", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col rounded-xl border border-border bg-panel">
      <div className="px-5 pt-4 pb-2">
        <h2 className="font-heading text-sm font-semibold">{title}</h2>
        {description && <p className="mt-0.5 text-[13px] text-muted-foreground">{description}</p>}
      </div>
      <div className="flex flex-col px-4 pb-3">{children}</div>
    </section>
  );
}

/**
 * ADMIN › Restaurant. What the business is configured as, read from the
 * rows that already drive every invoice, price, reward and delivery quote.
 * `settings.manage` (OWNER only) — the same permission the Rewards form
 * already uses, since these are the same kind of fact. Read-only: no edit
 * forms here until each is approved on its own, and no fake "Edit" buttons.
 */
export default async function RestaurantSettingsPage() {
  const staff = await requireStaff();
  if (!(await staffCan("settings.manage"))) {
    return (
      <div className="mx-auto w-full max-w-lg px-[var(--gutter)] py-16">
        <PermissionDenied action="view restaurant settings" />
      </div>
    );
  }

  const settings = await getRestaurantSettings(staff.orgId);
  if (!settings) {
    return (
      <div className="mx-auto w-full max-w-lg px-[var(--gutter)] py-16">
        <EmptyState title="No restaurant configured." detail="Run the seed to create the organization." />
      </div>
    );
  }

  const { organization, loyalty, location, delivery, taxRates } = settings;
  const inclusive = organization.priceBasis === "inclusive";

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-5 px-[var(--gutter)] py-6 md:py-8">
      <PageHeader
        title="Restaurant"
        description="What FRYBIRD is configured as. These values already drive every invoice, price, reward and delivery quote; changing any of them is a business decision, so this page shows them and edits only the operations settings the Overview reads."
      />

      <Section title="Business">
        <SettingRow label="Trading name" value={organization.name} />
        <SettingRow label="Legal name" description="As registered — often not the brand name." value={organization.legalName ?? <span className="text-muted-foreground">Not set</span>} />
        <SettingRow
          label="GSTIN"
          description="Printed on every tax invoice."
          value={organization.gstin ?? <Badge variant="destructive">Not set — invoices carry no GSTIN</Badge>}
        />
        <SettingRow
          label="Menu prices"
          description={inclusive ? "The board price is what the customer pays; GST is extracted from within it." : "GST is added on top of the board price at checkout."}
          value={inclusive ? "Include GST" : "Exclude GST"}
        />
        <SettingRow label="Currency" value={organization.currency} />
        <SettingRow label="Business day" description="Order numbers restart, and 'today' begins, on this clock." value={organization.timezone} />
      </Section>

      <Section title="Operations" description="Read by the Overview: kitchen load is open tickets against the capacity; the opening date decides which comparisons can honestly be offered.">
        <OperationsSettingsForm kitchenCapacity={organization.kitchenCapacity} openedOn={organization.openedOn} />
      </Section>

      <Section title="GST rates" description="Every product line is taxed at its own rate and carries its HSN/SAC code.">
        {taxRates.length === 0 ? (
          <p className="rounded-lg border border-border bg-surface px-4 py-6 text-center text-sm text-muted-foreground">No tax rates configured.</p>
        ) : (
          <div className="overflow-hidden rounded-xl border border-border bg-panel">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Rate</TableHead>
                  <TableHead>HSN / SAC</TableHead>
                  <TableHead className="text-right">GST</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {taxRates.map((rate) => (
                  <TableRow key={rate.id}>
                    <TableCell className="font-medium">
                      {rate.name}
                      {rate.isDefault && (
                        <Badge variant="outline" className="ml-2">
                          Default
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="tabular text-muted-foreground">{rate.hsnCode ?? "—"}</TableCell>
                    <TableCell className="tabular text-right font-semibold">{formatBps(rate.rateBps, 1)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Section>

      <Section title="Location">
        {location ? (
          <>
            <SettingRow label="Outlet" value={location.isActive ? location.name : `${location.name} (inactive)`} />
            <SettingRow
              label="Address"
              value={
                <span className="text-right font-normal">
                  {[location.addressLine1, location.addressLine2, location.city, location.pincode].filter(Boolean).join(", ") || "Not set"}
                </span>
              }
            />
            <SettingRow
              label="GST state"
              description="Decides CGST + SGST versus IGST on every order billed here."
              value={location.state ? `${location.state}${location.stateCode ? ` (${location.stateCode})` : ""}` : <span className="text-muted-foreground">Not set</span>}
            />
            <SettingRow label="Phone" value={location.phone ?? <span className="text-muted-foreground">Not set</span>} />
            <SettingRow
              label="On the map"
              description="Delivery cannot be priced until the outlet has a pin."
              value={delivery?.shop ? "Pinned" : <Badge variant="destructive">No pin</Badge>}
            />
          </>
        ) : (
          <p className="rounded-lg border border-border bg-surface px-4 py-6 text-center text-sm text-muted-foreground">No outlet configured.</p>
        )}
      </Section>

      <Section title="Delivery" description="Banded, not a flat per-kilometre formula: free nearby, a flat charge in the middle ring, per-km once it is far.">
        <SettingRow label="Delivery offered" value={delivery?.enabled ? "Yes" : <Badge variant="outline">Not yet — needs a pin and at least one band</Badge>} />
        <SettingRow
          label="Free delivery above"
          value={delivery?.rates.freeAboveOrderValue ? formatINR(delivery.rates.freeAboveOrderValue, "whole") : <span className="text-muted-foreground">Never</span>}
        />
        <SettingRow
          label="Road factor"
          description="Straight-line distance × this ≈ road distance."
          value={delivery ? `${(delivery.rates.roadFactorBps / 10_000).toFixed(2)}×` : "—"}
        />
        {delivery && delivery.rates.bands.length > 0 && (
          <div className="overflow-hidden rounded-xl border border-border bg-panel">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Up to</TableHead>
                  <TableHead className="text-right">Flat fee</TableHead>
                  <TableHead className="text-right">Per km beyond</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {delivery.rates.bands.map((band) => (
                  <TableRow key={band.upToMetres}>
                    <TableCell className="tabular font-medium">{(band.upToMetres / 1000).toFixed(1)} km</TableCell>
                    <TableCell className="tabular text-right">{band.flatFee === 0n ? "Free" : formatINR(band.flatFee)}</TableCell>
                    <TableCell className="tabular text-right text-muted-foreground">{band.perKmFee === 0n ? "—" : formatINR(band.perKmFee)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Section>

      <Section title="FRYBIRD REWARDS" description="Points and the 7+1 stamp card are separate mechanics; a customer earns both from one order.">
        <SettingRow label="Stamp card" value={loyalty.stampsEnabled ? "On" : "Off"} />
        <SettingRow label="Stamps for a free item" value={String(loyalty.stampsRequired)} />
        <SettingRow label="Order must exceed" description="Food and fees, less points redeemed — to earn a stamp." value={formatINR(loyalty.stampMinOrderValue, "whole")} />
        <SettingRow label="Free item worth up to" value={formatINR(loyalty.stampMaxRewardValue, "whole")} />
        <SettingRow label="Points earned" description="Share of qualifying spend returned as points. 0% means points are off." value={formatBps(loyalty.earnBps, 1)} />
        <SettingRow label="One point is worth" value={loyalty.pointValue === 0n ? <span className="text-muted-foreground">Not set</span> : formatINR(loyalty.pointValue)} />
        <SettingRow label="Minimum to redeem" value={loyalty.minRedeemPoints === 0 ? "No minimum" : `${loyalty.minRedeemPoints} points`} />
        <p className="text-sm text-muted-foreground">
          These are the one group with an edit form already —{" "}
          <Link href="/app/iq/rewards" className="font-semibold underline underline-offset-2">
            change them on Rewards
          </Link>
          .
        </p>
      </Section>
    </div>
  );
}
