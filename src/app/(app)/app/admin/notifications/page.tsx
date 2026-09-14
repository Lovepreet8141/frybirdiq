import type { Metadata } from "next";
import { type Capability, CapabilityPanel, DataTrust, Panel, PanelBody, PanelHeader, SampleTag } from "@/components/iq/ui";
import { AdminSectionNav } from "@/components/staff/admin-section-nav";
import { PageHeader } from "@/components/staff/page-header";
import { SettingRow } from "@/components/staff/setting-row";
import { PermissionDenied } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { requireStaff, staffCan } from "@/lib/auth";
import { adminNavAccess } from "@/lib/auth/admin-access";
import { paise } from "@/lib/money";
import { orderMessage } from "@/lib/notifications/messages";
import { requireOrg } from "@/lib/repositories/org";

export const metadata: Metadata = { title: "Notifications", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/** Which channels exist behind the `NotificationProvider` interface today (`src/lib/notifications/provider.ts`). */
const CHANNELS: readonly Capability[] = [
  { name: "WhatsApp order message, by link", connected: true, note: "Composed on the server from the stored order; a person opens WhatsApp and presses send" },
  { name: "New-order alert on staff screens", connected: true, note: "The chime and pop-up on the POS and orders board, driven by the realtime channel" },
  { name: "WhatsApp Business API (automatic)", connected: false, note: "Slots in behind the same provider interface; nothing to configure until a Business API account exists" },
  { name: "SMS", connected: false, note: "Provider interface exists, no vendor wired" },
  { name: "Email receipts", connected: false, note: "Provider interface exists, no vendor wired" },
  { name: "Customer push notifications", connected: false, note: "No customer app; the website is not installable yet" },
];

/**
 * ADMIN › Notifications. What FRYBIRD can send today, and what it says.
 * There is no preferences form because there is nothing to choose between
 * yet — one manual channel, one in-app alert — and a form that saved
 * nothing would be worse than none.
 */
export default async function NotificationsPage() {
  const staff = await requireStaff();
  if (!(await staffCan("settings.manage"))) {
    return (
      <div className="mx-auto w-full max-w-lg px-[var(--gutter)] py-16">
        <PermissionDenied action="view notification settings" />
      </div>
    );
  }

  const [access, org] = await Promise.all([adminNavAccess(), requireOrg()]);
  const siteUrl = process.env.SITE_URL?.replace(/\/$/, "") ?? null;
  const connected = CHANNELS.filter((channel) => channel.connected).length;

  // A template preview with placeholder values, labelled as such — never a real order.
  const preview = orderMessage({
    orderNumber: "1042",
    invoiceNumber: null,
    customerName: "Customer name",
    total: paise(29_900),
    isDelivery: false,
    isPaid: false,
    items: [
      { name: "Product name", quantity: 2 },
      { name: "Another product", quantity: 1 },
    ],
    link: `${siteUrl ?? "https://frybirdiq.tech"}/order/<order-id>`,
  });

  void staff;

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-[var(--gutter)] py-8">
      <PageHeader title="Notifications" description="What FRYBIRD can send a customer today, and the message it sends. Automatic channels arrive behind the same provider interface when a vendor is connected." />
      <AdminSectionNav current="notifications" access={access} />

      <DataTrust
        items={[
          { tone: "gain", text: `${connected} of ${CHANNELS.length} channels connected` },
          siteUrl ? { tone: "gain", text: `Order links point at ${siteUrl}` } : { tone: "loss", text: "SITE_URL is not set — a WhatsApp message would carry a link to nowhere, so sending is refused" },
        ]}
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <CapabilityPanel title="Channels" items={CHANNELS} className="lg:col-span-2" />

        <div className="flex flex-col gap-6">
          <Panel>
            <PanelHeader title="Sender" />
            <PanelBody className="pt-0">
              <SettingRow label="Business name" value={org.name} />
              <SettingRow label="Order link" description="Read at runtime from SITE_URL, never baked into a build." value={siteUrl ?? <Badge variant="destructive">Not set</Badge>} />
              <SettingRow label="Automatic sending" value={<Badge variant="outline">Not connected</Badge>} />
            </PanelBody>
          </Panel>
        </div>
      </div>

      <Panel>
        <PanelHeader
          title="Order message"
          description="Composed by src/lib/notifications/messages.ts from the stored order — items, total including GST, how to pay if unpaid, the invoice number, the link."
          meta={<SampleTag />}
        />
        <PanelBody className="pt-0">
          <pre className="max-w-xl whitespace-pre-wrap rounded-lg border border-border bg-surface-muted px-4 py-3 font-mono text-[12.5px] leading-[1.6]">{preview}</pre>
          <p className="mt-3 text-[12.5px] text-muted-foreground">Placeholder values, shown to illustrate the shape. A real message quotes the order row, and only an order with a phone number can be sent one.</p>
        </PanelBody>
      </Panel>
    </div>
  );
}
