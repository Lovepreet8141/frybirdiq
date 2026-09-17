/**
 * presentFor — the permission gate in front of present().
 *
 * IQ-2 DESIGN.md R2.2 and REVIEW-SECURITY-TENANCY.md. Payment-ledger findings
 * — reconciliation (`recon.*`) and payment crash signatures (`sig.*`) — are
 * finance data: shown only to a viewer with finance.view. Everyone else gets
 * `restricted: true` and nothing else: no rows, no count, and not even whether
 * such a finding exists, because the flag depends on the viewer alone.
 *
 * The prefixes are the ones 0037's RLS policy and ledger CHECK use, so the
 * app's gate and the database's agree on what counts as ledger data.
 * Aggregate business figures stay on analytics.view like the existing IQ
 * pages (owner decision dec-13 pending); this gate does not touch them.
 */
import { can, type Role } from "@/domain/permissions";

import type { Insight } from "./insight";
import { present, type Presentation } from "./present";

export const LEDGER_PRODUCER_PREFIXES = ["recon.", "sig."] as const;

export type InsightViewer = { readonly financeView: boolean };

export function viewerFor(roles: readonly Role[]): InsightViewer {
  return { financeView: can(roles, "finance.view") };
}

export function isLedgerInsight(insight: Pick<Insight, "producer">): boolean {
  return LEDGER_PRODUCER_PREFIXES.some((prefix) => insight.producer.startsWith(prefix));
}

export type ViewerPresentations = {
  readonly items: readonly Presentation[];
  /** True for every viewer without finance.view, whatever the input holds. */
  readonly restricted: boolean;
};

export function presentFor(insights: readonly Insight[], viewer: InsightViewer): ViewerPresentations {
  const visible = viewer.financeView ? insights : insights.filter((insight) => !isLedgerInsight(insight));
  return { items: visible.map((insight) => present(insight)), restricted: !viewer.financeView };
}
