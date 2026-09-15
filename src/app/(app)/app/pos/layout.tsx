import type { ReactNode } from "react";
import { DarkStaffSurface } from "@/components/staff/dark-staff-surface";

/** POS stays dark — see DarkStaffSurface for why it doesn't already. */
export default function PosLayout({ children }: { children: ReactNode }) {
  return <DarkStaffSurface>{children}</DarkStaffSurface>;
}
