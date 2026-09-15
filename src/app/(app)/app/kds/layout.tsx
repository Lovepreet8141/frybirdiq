import type { ReactNode } from "react";
import { DarkStaffSurface } from "@/components/staff/dark-staff-surface";

/** KDS stays dark — see DarkStaffSurface for why it doesn't already. */
export default function KdsLayout({ children }: { children: ReactNode }) {
  return <DarkStaffSurface>{children}</DarkStaffSurface>;
}
