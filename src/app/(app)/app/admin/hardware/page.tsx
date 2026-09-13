import type { Metadata } from "next";
import { DeviceAgent } from "@/components/hardware/device-agent";
import { HardwarePage } from "@/components/hardware/hardware-page";
import { PermissionDenied } from "@/components/states";
import { requireStaff, staffCan } from "@/lib/auth";
import { listDevices, listPrinters, recentPrintJobs } from "@/lib/repositories/hardware";
import { requireOrg } from "@/lib/repositories/org";

export const metadata: Metadata = { title: "Printers", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/**
 * Settings › Hardware › Printers. Anyone who can run the till can see it
 * and test the printer from the device next to it; adding, editing and
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
  const org = await requireOrg();
  const [devices, printers, jobs] = await Promise.all([listDevices(staff.orgId), listPrinters(staff.orgId), recentPrintJobs(staff.orgId, 15)]);
  return (
    <DeviceAgent autoRegister>
      <HardwarePage devices={devices} printers={printers} jobs={jobs} shopName={org.name} canManage={canManage} />
    </DeviceAgent>
  );
}
