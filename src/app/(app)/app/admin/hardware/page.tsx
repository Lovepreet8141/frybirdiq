import type { Metadata } from "next";
import { DeviceAgent } from "@/components/hardware/device-agent";
import { HardwarePage } from "@/components/hardware/hardware-page";
import { AdminSectionNav } from "@/components/staff/admin-section-nav";
import { PermissionDenied } from "@/components/states";
import { requireStaff, staffCan } from "@/lib/auth";
import { adminNavAccess } from "@/lib/auth/admin-access";
import { listDevices, listPrinters, recentPrintJobs } from "@/lib/repositories/hardware";
import { requireOrg } from "@/lib/repositories/org";

export const metadata: Metadata = { title: "Printers", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/**
 * Admin › Printers & devices. Anyone who can run the till can see it and
 * test the printer from the device next to it; adding, editing and
 * removing printers or devices takes `integrations.manage`.
 */
export default async function HardwareSettingsPage() {
  const staff = await requireStaff();
  const canManage = await staffCan("integrations.manage");
  if (!canManage && !(await staffCan("orders.create"))) {
    return (
      <div className="mx-auto w-full max-w-lg px-[var(--gutter)] py-16">
        <PermissionDenied action="see the store's printers" />
      </div>
    );
  }
  const [org, access, devices, printers, jobs] = await Promise.all([requireOrg(), adminNavAccess(), listDevices(staff.orgId), listPrinters(staff.orgId), recentPrintJobs(staff.orgId, 15)]);
  return (
    <DeviceAgent autoRegister>
      <HardwarePage devices={devices} printers={printers} jobs={jobs} shopName={org.name} canManage={canManage} sectionNav={<AdminSectionNav current="hardware" access={access} />} />
    </DeviceAgent>
  );
}
