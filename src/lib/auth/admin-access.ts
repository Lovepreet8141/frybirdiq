import "server-only";

import { staffCan } from "@/lib/auth";
import type { AdminNavAccess } from "@/components/staff/admin-section-nav";

/** The three gates the Admin strip needs, resolved once per page. Same rules the sidebar uses. */
export async function adminNavAccess(): Promise<AdminNavAccess> {
  const [canSeeSettings, canManageIntegrations, canCreateOrders, canSeeAudit] = await Promise.all([staffCan("settings.manage"), staffCan("integrations.manage"), staffCan("orders.create"), staffCan("audit.view")]);
  return { canSeeSettings, canSeeHardware: canManageIntegrations || canCreateOrders, canSeeAudit };
}
