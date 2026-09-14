import Link from "next/link";
import { cn } from "@/lib/utils";

export type AnalyticsSection = "products" | "channels" | "food-cost" | "expenses" | "customers";

const SECTIONS: readonly { readonly key: AnalyticsSection; readonly label: string; readonly href: string; readonly needs?: "customers" }[] = [
  { key: "products", label: "Products & categories", href: "/app/iq/products" },
  { key: "channels", label: "Channels", href: "/app/iq/channels" },
  { key: "food-cost", label: "Food cost & P&L", href: "/app/iq/pnl" },
  { key: "expenses", label: "Expenses", href: "/app/iq/expenses" },
  { key: "customers", label: "Customers", href: "/app/customers", needs: "customers" },
];

/**
 * The strip every Analytics report carries. Routes, not client tabs — each
 * report has its own period and its own gate. Waste is listed unlinked and
 * marked not connected: the waste log is roadmap 3.3 and there is nothing
 * to report until it writes rows.
 */
export function AnalyticsSectionNav({ current, canSeeCustomers }: { current: AnalyticsSection; canSeeCustomers: boolean }) {
  const visible = SECTIONS.filter((section) => (section.needs === "customers" ? canSeeCustomers : true));
  return (
    <nav aria-label="Analytics reports" className="-mb-px flex max-w-full gap-1 overflow-x-auto border-b border-border">
      {visible.map((section) => {
        const active = section.key === current;
        return (
          <Link
            key={section.key}
            href={section.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex h-10 shrink-0 items-center border-b-2 px-3 text-[13.5px] transition-colors duration-[120ms]",
              active ? "border-primary font-semibold text-foreground" : "border-transparent font-medium text-muted-foreground hover:text-foreground",
            )}
          >
            {section.label}
          </Link>
        );
      })}
      <span className="flex h-10 shrink-0 items-center gap-1.5 border-b-2 border-transparent px-3 text-[13.5px] font-medium text-muted-foreground/70" aria-disabled="true" title="The waste log is roadmap 3.3; nothing to report until it records entries.">
        Waste
        <span className="rounded-full bg-flag-soft px-1.5 py-0.5 text-[10.5px] font-semibold uppercase tracking-[0.06em] text-flag">Not connected</span>
      </span>
    </nav>
  );
}
