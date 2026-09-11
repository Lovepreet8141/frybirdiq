import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { RewardsSettingsForm } from "@/components/iq/rewards-settings-form";
import { getStaff, staffCan } from "@/lib/auth";
import { getStampConfig } from "@/lib/loyalty/config";

export const metadata: Metadata = { title: "FRYBIRD REWARDS settings — FRYBIRD IQ", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/**
 * Configures FRYBIRD REWARDS — the one universal stamp card.
 *
 * `settings.manage` rather than `analytics.view`: this changes what the
 * business gives away on every qualifying order, which is an owner decision
 * the same way `priceBasis` and the GSTIN are, not a day-to-day IQ read.
 */
export default async function RewardsSettingsPage() {
  const staff = await getStaff();
  if (!staff) redirect("/sign-in");
  if (!(await staffCan("settings.manage"))) redirect("/app/iq");

  const config = await getStampConfig();

  return (
    <div className="mx-auto w-full max-w-3xl px-[var(--gutter)] py-8">
      <Link href="/app/iq" className="text-sm text-muted-foreground underline underline-offset-2">
        ← FRYBIRD IQ
      </Link>
      <h1 className="mt-3 font-heading text-3xl font-bold tracking-tight">FRYBIRD REWARDS</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        The one universal stamp card — spend over a threshold, earn a stamp, collect enough and one item up to a cap is
        free. Changing these rules here takes effect on the next order priced; nothing needs a deploy.
      </p>

      <RewardsSettingsForm
        enabled={config.enabled}
        stampsRequired={config.stampsRequired}
        minOrderValue={config.minOrderValue}
        maxRewardValue={config.maxRewardValue}
      />
    </div>
  );
}
