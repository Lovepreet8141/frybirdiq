import type { Metadata } from "next";
import { DriverPrototype } from "@/components/driver-prototype/driver-prototype";
import { PermissionDenied } from "@/components/states";
import { staffCan } from "@/lib/auth";

export const metadata: Metadata = { title: "Driver App prototype", robots: { index: false, follow: false } };

/**
 * The Driver App design prototype — a separate, isolated workstream.
 *
 * Signed-in staff only (the app layout gates that), and only those who can
 * see deliveries or manage settings. No repository, action, realtime or
 * hardware code is reachable from here: the prototype runs on invented
 * data inside `src/components/driver-prototype`. It exists so the driver
 * experience can be reviewed before dispatch, GPS and routing are designed.
 */
export default async function DriverPreviewPage() {
  const [canSeeDeliveries, canManageSettings] = await Promise.all([staffCan("delivery.view"), staffCan("settings.manage")]);
  if (!canSeeDeliveries && !canManageSettings) {
    return (
      <div className="mx-auto w-full max-w-lg px-[var(--gutter)] py-16">
        <PermissionDenied action="review the driver app prototype" />
      </div>
    );
  }
  return <DriverPrototype />;
}
