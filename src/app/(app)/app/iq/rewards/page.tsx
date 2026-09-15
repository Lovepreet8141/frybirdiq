import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { RewardsSettingsForm } from "@/components/iq/rewards-settings-form";
import { Panel, PanelBody, PanelHeader } from "@/components/iq/ui";
import { PageHeader } from "@/components/staff/page-header";
import { PermissionDenied } from "@/components/states";
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

  if (!(await staffCan("settings.manage"))) {
    return (
      <div className="mx-auto w-full max-w-lg px-[var(--gutter)] py-16">
        <PermissionDenied action="change FRYBIRD REWARDS" />
      </div>
    );
  }

  const config = await getStampConfig();

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-[var(--gutter)] py-8">
      <PageHeader
        title="FRYBIRD REWARDS"
        description="The one universal stamp card — spend over a threshold, earn a stamp, collect enough and one item up to a cap is free. Changing these rules here takes effect on the next order priced; nothing needs a deploy."
      />

      <Panel className="max-w-lg">
        <PanelHeader title="Stamp card rules" />
        <PanelBody>
          <RewardsSettingsForm
            enabled={config.enabled}
            stampsRequired={config.stampsRequired}
            minOrderValue={config.minOrderValue}
            maxRewardValue={config.maxRewardValue}
          />
        </PanelBody>
      </Panel>
    </div>
  );
}
