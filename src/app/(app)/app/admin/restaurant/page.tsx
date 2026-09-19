import type { Metadata } from "next";
import Link from "next/link";
import { DataTrust, Panel, PanelBody, PanelHeader } from "@/components/iq/ui";
import { AdminSectionNav } from "@/components/staff/admin-section-nav";
import { BusinessProfileForm } from "@/components/staff/business-profile-form";
import { DeliveryPricingForm } from "@/components/staff/delivery-pricing-form";
import { LocationProfileForm } from "@/components/staff/location-profile-form";
import { OperationsSettingsForm } from "@/components/staff/operations-settings-form";
import { PageHeader } from "@/components/staff/page-header";
import { PaymentSettingsForm } from "@/components/staff/payment-settings-form";
import { SettingRow } from "@/components/staff/setting-row";
import { EmptyState, PermissionDenied } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireStaff, staffCan } from "@/lib/auth";
import { adminNavAccess } from "@/lib/auth/admin-access";
import { formatBps, formatINR } from "@/lib/money";
import { getClosuresOverview } from "@/lib/repositories/closed-dates";
import { getRestaurantSettings } from "@/lib/repositories/settings";
import { getOrderingStatusForStaff } from "@/lib/repositories/shop-status";
import { businessDate } from "@/lib/dates";
import { sinceLabel } from "@/lib/settings/close-shop-copy";
import { preOrderRows, rangeLabel } from "@/lib/settings/closures-copy";
import { CloseShopPanel } from "./close-shop-panel";
import { ClosuresPanel } from "./closures-panel";

export const metadata: Metadata = { title: "Restaurant", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/**
 * ADMIN › Restaurant. What the business is configured as, read from the
 * rows that already drive every invoice, price, reward and delivery quote.
 * `settings.manage` (OWNER only). Read-only apart from the operations
 * settings the Overview reads; no fake "Edit" buttons.
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

  const [settings, access, ordering, closures] = await Promise.all([getRestaurantSettings(staff.orgId), adminNavAccess(), getOrderingStatusForStaff(staff.orgId), getClosuresOverview(staff.orgId)]);
  if (!settings) {
    return (
      <div className="mx-auto w-full max-w-lg px-[var(--gutter)] py-16">
        <EmptyState title="No restaurant configured" detail="Run the seed to create the organization." />
      </div>
    );
  }

  const now = new Date();
  const { organization, loyalty, location, delivery, taxRates } = settings;
  const inclusive = organization.priceBasis === "inclusive";
  const gaps = [!organization.gstin && "GSTIN", !organization.legalName && "legal name", !location && "outlet", location && !delivery?.shop && "map pin", location && !location.state && "GST state", taxRates.length === 0 && "GST rates"].filter((gap): gap is string => typeof gap === "string");

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-[var(--gutter)] py-8">
      {ordering && (
        <CloseShopPanel
          status={ordering}
          pausedSince={ordering.state === "paused" ? sinceLabel(ordering.pausedAt, now) : null}
        />
      )}
      {closures && (
        <ClosuresPanel
          weeklyClosedDays={closures.weeklyClosedDays}
          closedDates={closures.closedDates
            // Ended days stay in the table for a day (a session can run past midnight); the list shows only what is still ahead or now.
            .filter((range) => range.endDate >= businessDate(now))
            .map((range) => ({
              id: range.id,
              label: rangeLabel(range.startDate, range.endDate),
              note: range.note,
              current: range.startDate <= businessDate(now) && range.endDate >= businessDate(now),
            }))}
          preOrders={preOrderRows(closures.preOrdersOnClosedDays)}
        />
      )}
      <PageHeader title="Restaurant" description="What FRYBIRD is configured as. These values already drive every invoice, price, reward and delivery quote; changing one is a business decision, so this page shows them and edits only the operations settings the Overview reads." />
      <AdminSectionNav current="restaurant" access={access} />

      <DataTrust
        items={[
          { tone: "gain", text: `${organization.name} · prices ${inclusive ? "include" : "exclude"} GST · ${organization.timezone}` },
          gaps.length === 0 ? { tone: "gain", text: "Every setting an invoice or a delivery quote needs is present" } : { tone: "flag", text: `Not set: ${gaps.join(", ")}` },
          { tone: "neutral", text: "Edit forms for these fields are not connected — each is its own approval" },
        ]}
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel>
          <PanelHeader title="Business" />
          <PanelBody className="pt-0">
            <SettingRow label="Trading name" value={organization.name} />
            <SettingRow label="Legal name" description="As registered — often not the brand name." value={organization.legalName ?? <span className="text-muted-foreground">Not set</span>} />
            <SettingRow label="GSTIN" description="Printed on every tax invoice." value={organization.gstin ?? <Badge variant="destructive">Not set — invoices carry no GSTIN</Badge>} />
            <SettingRow label="Menu prices" description={inclusive ? "The board price is what the customer pays; GST is extracted from within it." : "GST is added on top of the board price at checkout."} value={inclusive ? "Include GST" : "Exclude GST"} />
            <SettingRow label="Currency" value={organization.currency} />
            <SettingRow label="Business day" description="Order numbers restart, and 'today' begins, on this clock." value={organization.timezone} />
            <div className="pt-3">
              <BusinessProfileForm name={organization.name} openingTime={organization.openingTime} closingTime={organization.closingTime} />
            </div>
          </PanelBody>
        </Panel>

        <Panel>
          <PanelHeader title="Payment methods" description="What checkout offers, and the cash-on-delivery cap. Online only actually appears once Razorpay is configured, whatever this says." />
          <PanelBody className="pt-0">
            <PaymentSettingsForm codCapRupees={Number(organization.codCap / 100n)} cashEnabled={organization.cashEnabled} onlineEnabled={organization.onlineEnabled} />
          </PanelBody>
        </Panel>

        <div className="flex flex-col gap-6">
          <Panel>
            <PanelHeader title="Operations" description="Read by the Overview: kitchen load is open tickets against the capacity; the opening date decides which comparisons can honestly be offered." />
            <PanelBody className="pt-0">
              <OperationsSettingsForm kitchenCapacity={organization.kitchenCapacity} openedOn={organization.openedOn} />
            </PanelBody>
          </Panel>

          <Panel>
            <PanelHeader title="GST rates" description="Every product line is taxed at its own rate and carries its HSN/SAC code." meta={taxRates.length > 0 ? `${taxRates.length}` : undefined} />
            {taxRates.length === 0 ? (
              <PanelBody className="pt-0">
                <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-[13px] text-muted-foreground">No tax rates configured.</p>
              </PanelBody>
            ) : (
              <PanelBody flush className="border-t border-border pb-0">
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
              </PanelBody>
            )}
          </Panel>
        </div>

        <Panel>
          <PanelHeader title="Location" />
          <PanelBody className="pt-0">
            {location ? (
              <>
                <SettingRow label="Outlet" value={location.isActive ? location.name : `${location.name} (inactive)`} />
                <SettingRow label="Address" value={<span className="text-right font-normal">{[location.addressLine1, location.addressLine2, location.city, location.pincode].filter(Boolean).join(", ") || "Not set"}</span>} />
                <SettingRow label="GST state" description="Decides CGST + SGST versus IGST on every order billed here." value={location.state ? `${location.state}${location.stateCode ? ` (${location.stateCode})` : ""}` : <span className="text-muted-foreground">Not set</span>} />
                <SettingRow label="Phone" value={location.phone ?? <span className="text-muted-foreground">Not set</span>} />
                <SettingRow label="On the map" description="Delivery cannot be priced until the outlet has a pin." value={delivery?.shop ? <Badge variant="success">Pinned</Badge> : <Badge variant="destructive">No pin</Badge>} />
                <div className="pt-3">
                  <LocationProfileForm
                    addressLine1={location.addressLine1}
                    addressLine2={location.addressLine2}
                    city={location.city}
                    pincode={location.pincode}
                    phone={location.phone}
                  />
                </div>
              </>
            ) : (
              <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-[13px] text-muted-foreground">No outlet configured.</p>
            )}
          </PanelBody>
        </Panel>

        <Panel className="lg:col-span-2">
          <PanelHeader title="Delivery Pricing" description="Banded distance pricing, and an optional free-delivery rule that only waives the fee when both the distance and the order value qualify." />
          <PanelBody className="pt-0">
            <SettingRow label="Delivery offered" value={delivery?.enabled ? <Badge variant="success">Yes</Badge> : <Badge variant="outline">Not yet — needs a pin and at least one band</Badge>} />
            <SettingRow label="Road factor" description="Straight-line distance × this ≈ road distance. Not editable here." value={delivery ? `${(delivery.rates.roadFactorBps / 10_000).toFixed(2)}×` : "—"} />
            {delivery && delivery.enabled ? (
              <div className="pt-4">
                <DeliveryPricingForm
                  freeEnabled={delivery.rates.freeEnabled}
                  freeAboveOrderValueRupees={delivery.rates.freeAboveOrderValue === null ? null : Number(delivery.rates.freeAboveOrderValue / 100n)}
                  freeMaxKm={delivery.rates.freeMaxMetres === null ? null : delivery.rates.freeMaxMetres / 1000}
                  bands={delivery.rates.bands.map((band) => ({
                    upToKm: String(band.upToMetres / 1000),
                    flatFee: String(band.flatFee / 100n),
                    perKmFee: String(band.perKmFee / 100n),
                  }))}
                />
              </div>
            ) : (
              <p className="mt-3 rounded-lg border border-dashed border-border px-4 py-6 text-center text-[13px] text-muted-foreground">
                Delivery needs a map pin and at least one distance band before pricing can be edited here.
              </p>
            )}
          </PanelBody>
        </Panel>

        <Panel className="lg:col-span-2">
          <PanelHeader
            title="FRYBIRD REWARDS"
            description="Points and the 7+1 stamp card are separate mechanics; a customer earns both from one order."
            action={
              <Button variant="outline" size="sm" asChild>
                <Link href="/app/iq/rewards">Change on Rewards</Link>
              </Button>
            }
          />
          <PanelBody className="grid gap-x-8 pt-0 md:grid-cols-2">
            <div>
              <SettingRow label="Stamp card" value={loyalty.stampsEnabled ? <Badge variant="success">On</Badge> : <Badge variant="outline">Off</Badge>} />
              <SettingRow label="Stamps for a free item" value={String(loyalty.stampsRequired)} />
              <SettingRow label="Order must exceed" description="Food and fees, less points redeemed — to earn a stamp." value={formatINR(loyalty.stampMinOrderValue, "whole")} />
              <SettingRow label="Free item worth up to" value={formatINR(loyalty.stampMaxRewardValue, "whole")} />
            </div>
            <div>
              <SettingRow label="Points earned" description="Share of qualifying spend returned as points. 0% means points are off." value={formatBps(loyalty.earnBps, 1)} />
              <SettingRow label="One point is worth" value={loyalty.pointValue === 0n ? <span className="text-muted-foreground">Not set</span> : formatINR(loyalty.pointValue)} />
              <SettingRow label="Minimum to redeem" value={loyalty.minRedeemPoints === 0 ? "No minimum" : `${loyalty.minRedeemPoints} points`} />
            </div>
          </PanelBody>
        </Panel>
      </div>
    </div>
  );
}
