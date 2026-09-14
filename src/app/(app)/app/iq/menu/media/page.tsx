import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { MediaLibrary } from "@/components/iq/menu/media-library";
import { MenuSectionNav } from "@/components/iq/menu/menu-section-nav";
import { DataTrust } from "@/components/iq/ui";
import { PageHeader } from "@/components/staff/page-header";
import { PermissionDenied } from "@/components/states";
import { getStaff, staffCan } from "@/lib/auth";
import { listMediaWithUsage } from "@/lib/repositories/media";
import { listDraftItems } from "@/lib/repositories/menu-admin";

export const metadata: Metadata = { title: "Media library — FRYBIRD IQ", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function MediaLibraryPage() {
  const staff = await getStaff();
  if (!staff) redirect("/sign-in");
  if (!(await staffCan("menu.edit"))) {
    return (
      <div className="mx-auto w-full max-w-lg px-[var(--gutter)] py-16">
        <PermissionDenied action="manage media" />
      </div>
    );
  }

  const [canPublish, items, drafts] = await Promise.all([staffCan("menu.publish"), listMediaWithUsage(staff.orgId), listDraftItems(staff.orgId)]);
  const unused = items.filter((item) => item.usedBy.length === 0).length;

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-[var(--gutter)] py-8">
      <PageHeader title="Media library" description="Upload once, use on any product or category. JPEG, PNG or WebP up to 8 MB; only an owner, admin or manager can upload or delete, and the public site only ever reads." />
      <MenuSectionNav current="media" draftCount={drafts.length} canEdit canPublish={canPublish} />
      <DataTrust
        items={[
          { tone: "gain", text: `${items.length} ${items.length === 1 ? "upload" : "uploads"}` },
          ...(unused > 0 ? [{ tone: "neutral" as const, text: `${unused} not used by any product or category` }] : []),
        ]}
      />
      <MediaLibrary initialItems={items} />
    </div>
  );
}
