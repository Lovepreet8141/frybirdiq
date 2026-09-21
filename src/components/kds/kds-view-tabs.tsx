import Link from "next/link";
import { STATIONS, STATION_LABEL, type Station } from "@/lib/kitchen/stations";
import { cn } from "@/lib/utils";

/** Which kitchen screen you are on: the all-in-one board, one station, or EXPO. */
export function KdsViewTabs({ active, stations = STATIONS }: { active: "ALL" | "EXPO" | Station; /** The stations that get a tab; DRINKS is left out until the menu has a drink. */ stations?: readonly Station[] }) {
  const tabs = [
    { key: "ALL", href: "/app/kds", label: "All tickets" },
    ...stations.map((station) => ({ key: station, href: `/app/kds/station/${station.toLowerCase()}`, label: STATION_LABEL[station] })),
    { key: "EXPO", href: "/app/kds/expo", label: "Expo" },
  ];
  return (
    <nav aria-label="Kitchen screens" className="flex gap-2 overflow-x-auto border-b border-border bg-surface px-3 py-2">
      {tabs.map((tab) => (
        <Link
          key={tab.key}
          href={tab.href}
          aria-current={tab.key === active ? "page" : undefined}
          className={cn(
            "inline-flex min-h-[44px] items-center whitespace-nowrap rounded-md border px-4 text-sm font-semibold",
            tab.key === active ? "border-primary bg-primary text-primary-foreground" : "border-border bg-panel hover:border-border-strong",
          )}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
