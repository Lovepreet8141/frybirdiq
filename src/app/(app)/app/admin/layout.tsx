import type { ReactNode } from "react";
import { AdminNav, type AdminNavItem } from "@/components/staff/admin-nav";
import { staffCan } from "@/lib/auth";

/**
 * Settings: the one nav above every admin page. Which items appear follows
 * the same permissions the sidebar uses, so a page never shows up here
 * that the sidebar would hide.
 */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  const [settings, hardware, audit] = await Promise.all([staffCan("settings.manage"), Promise.all([staffCan("integrations.manage"), staffCan("orders.create")]).then((flags) => flags.some(Boolean)), staffCan("audit.view")]);
  const items: AdminNavItem[] = [
    ...(settings ? [{ href: "/app/admin/restaurant", label: "Restaurant" }, { href: "/app/admin/receipt", label: "Bill & Receipt" }] : []),
    ...(hardware ? [{ href: "/app/admin/hardware", label: "Printers" }] : []),
    ...(audit ? [{ href: "/app/admin/audit", label: "Audit log" }] : []),
  ];
  return (
    <>
      <AdminNav items={items} />
      {children}
    </>
  );
}
